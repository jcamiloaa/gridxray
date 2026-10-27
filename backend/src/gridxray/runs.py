"""Runs investigations in background threads, streams their events and survives restarts.

Events are written to Postgres as they happen. On startup, any run still marked "running"
(the service stopped mid-investigation) is resumed: experiments already done are restored
from its log, never repeated, and Muse Spark continues from a summary of the state.
"""

import hashlib
import threading
import time
import traceback
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from gridxray.agent.client import MetaClient
from gridxray.agent.investigator import Event, Investigator
from gridxray.lab import Complexity, Reference, Scenario, generate_scenario, load_reference
from gridxray.pricing import summarize
from gridxray.store.db import SessionLocal
from gridxray.store.models import InvestigationRun
from gridxray.verify.baselines import exhaustive, geographic, heuristic, passive
from gridxray.verify.score import score

FLUSH_EVERY = 2.0  # seconds between writes of the live event log


def session_key(token: str | None) -> str | None:
    return hashlib.sha256(token.encode()).hexdigest()[:32] if token else None


@dataclass
class LiveRun:
    id: str
    user_id: int
    source: str
    seed: int
    budget: int
    session: str | None = None
    language: str = "en"
    status: str = "running"
    events: list[dict] = field(default_factory=list)
    score: dict | None = None
    usage: dict | None = None
    investigator: Investigator | None = field(default=None, repr=False)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _flushed: float = 0.0

    def push(self, event: dict) -> None:
        with self.lock:
            self.events.append(event)
        if event["kind"] == "usage":
            self.usage = {k: v for k, v in event.items() if k not in ("t", "kind")}
        if time.monotonic() - self._flushed > FLUSH_EVERY or event["kind"] in ("experiment", "result", "done"):
            self.flush()

    def since(self, index: int) -> list[dict]:
        with self.lock:
            return self.events[index:]

    def flush(self) -> None:
        self._flushed = time.monotonic()
        with SessionLocal() as db:
            row = db.get(InvestigationRun, self.id)
            if row:
                row.status, row.events, row.score, row.usage = self.status, self.since(0), self.score, self.usage
                db.commit()


def make_scenario(source: str, seed: int) -> Scenario:
    if source in {r.value for r in Reference}:
        return load_reference(Reference(source), seed)
    return generate_scenario(Complexity(source), seed)


def run_summary(row: InvestigationRun | LiveRun) -> dict:
    sc = (row.score or {}).get("gridxray") if row.score else None
    usage = row.usage or {}
    return {"id": row.id, "source": row.source, "seed": row.seed, "budget": row.budget, "status": row.status,
            "created_at": getattr(row, "created_at", None), "f1": sc["f1"] if sc else None,
            "experiments": sc["experiments"] if sc else sum(1 for e in row.events if e.get("kind") == "experiment" and e.get("accepted")),
            "tokens": usage.get("tokens", 0), "cost_usd": usage.get("cost_usd", 0.0)}


class RunManager:
    def __init__(self, client_factory: Callable[[], MetaClient] = MetaClient) -> None:
        self.client_factory = client_factory
        self.runs: dict[str, LiveRun] = {}

    def active_for(self, user_id: int, session: str | None = None) -> LiveRun | None:
        """Running investigation for this user; demo users are told apart by browser session."""
        return next((r for r in self.runs.values() if r.user_id == user_id and r.session == session
                     and r.status == "running"), None)

    def running_count(self) -> int:
        return sum(r.status == "running" for r in self.runs.values())

    def start(self, user_id: int, source: str, seed: int, budget: int, session: str | None = None,
              language: str = "en") -> LiveRun:
        run = LiveRun(uuid.uuid4().hex, user_id, source, seed, budget, session, language)
        self.runs[run.id] = run
        with SessionLocal() as db:
            db.add(InvestigationRun(id=run.id, user_id=user_id, source=source, seed=seed, budget=budget,
                                    status="running", events=[], session_key=session, language=language))
            db.commit()
        self._spawn(run)
        return run

    def resume(self, row: InvestigationRun) -> LiveRun:
        """Continue a run that stopped mid-way (restart, failure or user stop) from its event log."""
        run = LiveRun(row.id, row.user_id, row.source, row.seed, row.budget, row.session_key,
                      row.language or "en", events=list(row.events or []), usage=row.usage)
        run.status = "running"
        self.runs[run.id] = run
        run.flush()
        self._spawn(run, restore=True)
        return run

    def stop(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if run and run.status == "running" and run.investigator:
            run.investigator.stop()
            return True
        return False

    def resume_interrupted(self) -> int:
        """Called at startup: resume every run the previous process left running."""
        with SessionLocal() as db:
            rows = db.query(InvestigationRun).filter(InvestigationRun.status == "running").all()
            for row in rows:
                db.expunge(row)
        for row in rows:
            self.resume(row)
        return len(rows)

    def _spawn(self, run: LiveRun, restore: bool = False) -> None:
        threading.Thread(target=self._work, args=(run, restore), daemon=True, name=f"investigation-{run.id[:8]}").start()

    def _work(self, run: LiveRun, restore: bool) -> None:
        t_offset = run.events[-1]["t"] if run.events else 0.0
        t0 = time.perf_counter() - t_offset
        try:
            s = make_scenario(run.source, run.seed)
            # drop a stale "done" from a previous attempt: this run continues
            if restore:
                with run.lock:
                    run.events = [e for e in run.events if e.get("kind") != "done"]
            inv = Investigator(s, budget=run.budget, client=self.client_factory(),
                               on_event=lambda e: run.push(e.to_dict()), language=run.language, t_offset=t_offset)
            run.investigator = inv
            if restore and run.events:
                inv.restore(run.events)
            result = inv.investigate()
            baselines = []
            for f in (geographic, passive, lambda sc: heuristic(sc, run.budget), exhaustive):
                b = f(make_scenario(run.source, run.seed))
                baselines.append({"name": b.name, **score(s, b.candidate.parent, experiments=b.experiments).to_dict()})
            run.usage = result.usage_summary
            if result.result:
                sc = score(s, result.result["parent"], result.result["uncertain"], result.experiments_used)
                run.score = {"gridxray": sc.to_dict(), "baselines": baselines, "steps": result.steps,
                             "reviews": result.reviews, "tokens": result.tokens, "usage": run.usage,
                             "seconds": round(time.perf_counter() - t0, 1)}
            else:
                run.score = {"gridxray": None, "baselines": baselines, "usage": run.usage}
            run.status = "stopped" if result.stopped else ("done" if result.result else "failed")
        except Exception as e:  # noqa: BLE001 - a failed run must still close cleanly for the UI
            run.push(Event(time.perf_counter() - t0, "error", {"message": f"{type(e).__name__}: {e}"}).to_dict())
            traceback.print_exc()
            run.status = "failed"
        run.push({"t": round(time.perf_counter() - t0, 2), "kind": "done", "status": run.status,
                  "score": run.score, "usage": run.usage})
        run.flush()


manager = RunManager()


def usage_totals(rows: list[dict]) -> dict:
    by_model: dict[str, dict] = {}
    for r in rows:
        for m, u in ((r.get("usage") or {}).get("by_model") or {}).items():
            acc = by_model.setdefault(m, {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 0})
            for k in acc:
                acc[k] += u.get(k, 0)
    return summarize(by_model)
