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

from gridxray import media
from gridxray.agent.client import MetaClient
from gridxray.agent.investigator import Event, Investigator
from gridxray.lab import Complexity, Reference, Scenario, generate_scenario, load_reference
from gridxray.pricing import summarize
from gridxray.seal import ALGORITHM, canonical, commitment, new_nonce
from gridxray.store.db import SessionLocal
from gridxray.store.models import InvestigationRun
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
    seal_nonce: str | None = field(default=None, repr=False)
    plan_kind: str = "none"  # the utility's initial plan for this run
    plan_date: str | None = None
    investigator: Investigator | None = field(default=None, repr=False)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    closed: bool = False  # stopped by the user: the log is final, late work from the thread is dropped
    _flushed: float = 0.0

    def push(self, event: dict) -> None:
        with self.lock:
            if self.closed and event["kind"] != "usage":
                return
            if not self.closed:
                self.events.append(event)
        if event["kind"] in ("started", "replan"):  # the planning agent decided (or extended) the budget
            self.budget = int(event.get("budget") or self.budget)
        if event["kind"] == "usage":  # a model call that was in flight when stopped is still billed
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
                row.budget = self.budget
                db.commit()


def make_scenario(source: str, seed: int) -> Scenario:
    if source.startswith("custom:"):  # a network designed in the editor
        from gridxray.lab.custom import Design, build_custom
        from gridxray.store.models import CustomGrid

        with SessionLocal() as db:
            row = db.get(CustomGrid, source.split(":", 1)[1])
            if row is None:
                raise ValueError("this designed network was deleted")
            return build_custom(Design(**row.design), seed, source)
    if source in {r.value for r in Reference}:
        return load_reference(Reference(source), seed)
    return generate_scenario(Complexity(source), seed)


def apply_interventions(s: Scenario, events: list[dict]) -> int:
    """Replay the field interventions of a run onto a fresh scenario (resume, seal, reveal)."""
    import dataclasses

    n = 0
    for e in events:
        if e.get("kind") != "intervention":
            continue
        for w in e.get("switches", []):
            s.net.switch.at[w["id"], "closed"] = w["closed"]
        if e.get("meters_off_ids"):
            s.sensors = dataclasses.replace(s.sensors, faulty_meters={**s.sensors.faulty_meters,
                                                                      **{int(m): "dead" for m in e["meters_off_ids"]}})
        n += 1
    if n:
        s.solve(s.hour)
    return n


def run_summary(row: InvestigationRun | LiveRun) -> dict:
    sc = (row.score or {}).get("gridxray") if row.score else None
    usage = row.usage or {}
    return {"id": row.id, "source": row.source, "seed": row.seed, "budget": row.budget, "status": row.status,
            "created_at": getattr(row, "created_at", None), "f1": sc["f1"] if sc else None,
            "experiments": sc["experiments"] if sc else sum(1 for e in row.events if e.get("kind") == "experiment" and e.get("accepted")),
            "tokens": usage.get("tokens", 0), "cost_usd": usage.get("cost_usd", 0.0)}


class RunManager:
    def __init__(self, client_factory: Callable[..., MetaClient] = MetaClient) -> None:
        self.client_factory = client_factory
        self.runs: dict[str, LiveRun] = {}

    def active_for(self, user_id: int, session: str | None = None) -> LiveRun | None:
        """Running investigation for this user; demo users are told apart by browser session."""
        return next((r for r in self.runs.values() if r.user_id == user_id and r.session == session
                     and r.status == "running"), None)

    def running_count(self) -> int:
        return sum(r.status == "running" for r in self.runs.values())

    def start(self, user_id: int, source: str, seed: int, budget: int, session: str | None = None,
              language: str = "en", plan_kind: str = "none", plan_date: str | None = None) -> LiveRun:
        run = LiveRun(uuid.uuid4().hex, user_id, source, seed, budget, session, language, plan_kind=plan_kind, plan_date=plan_date)
        self.runs[run.id] = run
        with SessionLocal() as db:
            run.seal_nonce = new_nonce()
            db.add(InvestigationRun(id=run.id, user_id=user_id, source=source, seed=seed, budget=budget,
                                    status="running", events=[], session_key=session, language=language,
                                    seal_nonce=run.seal_nonce, plan_kind=plan_kind, plan_date=plan_date))
            db.commit()
        self._spawn(run)
        return run

    def resume(self, row: InvestigationRun) -> LiveRun:
        """Continue a run that stopped mid-way (restart, failure or user stop) from its event log."""
        run = LiveRun(row.id, row.user_id, row.source, row.seed, row.budget, row.session_key,
                      row.language or "en", events=list(row.events or []), usage=row.usage, seal_nonce=row.seal_nonce,
                      plan_kind=row.plan_kind or "none", plan_date=row.plan_date)
        run.status = "running"
        self.runs[run.id] = run
        run.flush()
        self._spawn(run, restore=True)
        return run

    def stop(self, run_id: str) -> bool:
        """Stop now, wherever the run is: the log closes at once; a model call in flight is abandoned."""
        run = self.runs.get(run_id)
        if not run or run.status != "running":
            return False
        if run.investigator:
            run.investigator.stop()
        t = round(run.events[-1]["t"] if run.events else 0.0, 2)
        run.push({"t": t, "kind": "stopped", "message": "Investigation stopped by the user."})
        run.status = "stopped"
        run.push({"t": t, "kind": "done", "status": "stopped", "score": run.score, "usage": run.usage})
        with run.lock:
            run.closed = True
        run.flush()
        return True

    def intervene(self, run_id: str, toggles: list[int], meters_off: list[int]) -> str | None:
        """Change the real network of a running investigation; the agents are not told."""
        from gridxray.sim.engine import apply_intervention

        run = self.runs.get(run_id)
        if not run or run.status != "running" or not run.investigator:
            return "this investigation is not running"
        s = run.investigator.run.toolbox.engine.s
        problem = apply_intervention(s, toggles, meters_off)
        if problem:
            return problem
        sw = s.net.switch

        def between(i: int) -> list[str]:
            line = int(sw.element.at[i])
            return [s.names[int(s.net.line.from_bus.at[line])], s.names[int(s.net.line.to_bus.at[line])]]

        t = round(run.events[-1]["t"] if run.events else 0.0, 2)
        run.push({"t": t, "kind": "intervention",
                  "switches": [{"id": i, "kind": s.switch_kind[i], "closed": bool(sw.closed.at[i]), "between": between(i)}
                               for i in toggles],
                  "meters_off": [s.names[m] for m in meters_off], "meters_off_ids": meters_off,
                  # a new commitment to the changed topology, published before the AI can react
                  "commitment": commitment(run.seal_nonce, canonical(s)) if run.seal_nonce else None})
        run.flush()
        return None

    def field_view(self, run_id: str) -> dict | None:
        """The real network as the field sees it (for the person intervening, never for the agents)."""
        run = self.runs.get(run_id)
        if not run or not run.investigator:
            return None
        s = run.investigator.run.toolbox.engine.s
        with s.lock:
            sw = s.net.switch
            switches = []
            for i in sorted(s.switch_kind):
                line = int(sw.element.at[i])
                a, b = int(s.net.line.from_bus.at[line]), int(s.net.line.to_bus.at[line])
                switches.append({"id": i, "kind": s.switch_kind[i], "closed": bool(sw.closed.at[i]),
                                 "documented_closed": s.documented_switch_closed[i],
                                 "between": [s.names.get(a, str(a)), s.names.get(b, str(b))]})
            meters = [{"id": n, "name": s.names[n], "offline": s.sensors.faulty_meters.get(n) == "dead"} for n in s.metered]
        return {"switches": switches, "meters": meters}

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
                apply_interventions(s, run.events)
                with run.lock:
                    run.events = [e for e in run.events if e.get("kind") != "done"]
            from gridxray.apikeys import key_for_user

            with SessionLocal() as db:
                api_key = key_for_user(db, run.user_id)  # the owner's key from the app, else backend/.env
            from gridxray.agent.planner import make_plan

            inv = Investigator(s, budget=run.budget or None, client=self.client_factory(api_key=api_key),
                               on_event=lambda e: run.push(e.to_dict()), language=run.language, t_offset=t_offset,
                               save_media=lambda data: media.save(run.id, data),
                               plan=make_plan(s, run.plan_kind, run.plan_date), autonomous=run.budget == 0)
            run.investigator = inv
            if run.closed:  # stopped before the investigator existed
                return
            if not any(e.get("kind") == "sealed" for e in run.events) and run.seal_nonce:
                # commit to the hidden topology before the AI sees anything, and publish what it will see
                from gridxray.agent.prompts import SPARK_INSTRUCTIONS

                run.push({"t": round(time.perf_counter() - t0, 2), "kind": "sealed", "algorithm": ALGORITHM,
                          "commitment": commitment(run.seal_nonce, canonical(s)),
                          "ai_input": inv.run.toolbox.t_get_overview(), "instructions": SPARK_INSTRUCTIONS,
                          "tools": [tool["name"] for tool in __import__("gridxray.tools", fromlist=["TOOLS"]).TOOLS]})
            if restore and run.events:
                inv.restore(run.events)
            result = inv.investigate()
            baselines: list[dict] = []  # results are scored against the real network, not other methods
            run.usage = result.usage_summary
            if result.result:
                sc = score(s, result.result["parent"], result.result["uncertain"], result.experiments_used)
                run.score = {"gridxray": sc.to_dict(), "baselines": baselines, "steps": result.steps,
                             "reviews": result.reviews, "tokens": result.tokens, "usage": run.usage,
                             "seconds": round(time.perf_counter() - t0, 1)}
            else:
                run.score = {"gridxray": None, "baselines": baselines, "usage": run.usage}
            if run.closed:
                return
            run.status = "stopped" if result.stopped else ("done" if result.result else "failed")
        except Exception as e:  # noqa: BLE001 - a failed run must still close cleanly for the UI
            run.push(Event(time.perf_counter() - t0, "error", {"message": f"{type(e).__name__}: {e}"}).to_dict())
            traceback.print_exc()
            if run.closed:
                return
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
            for k in (*acc, "images"):  # per-image models (Muse Image, SAM 3.1) bill by image, not by token
                if k in u:
                    acc[k] = acc.get(k, 0) + u[k]
    return summarize(by_model)
