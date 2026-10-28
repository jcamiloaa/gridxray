"""Orchestrates the investigation: Muse Spark runs the tool loop, Muse Wonder reviews on escalation."""

import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import openai

from gridxray.agent.client import MetaClient, reasoning_summary
from gridxray.agent.prompts import SPARK_INSTRUCTIONS, WONDER_INSTRUCTIONS, initial_task
from gridxray.config import Settings, settings
from gridxray.lab import Scenario
from gridxray.pricing import add_usage, summarize
from gridxray.tools import TOOLS, ToolBox
from gridxray.tools.registry import ToolError, dumps

MAX_RECOVERIES = 3  # times the conversation may be rebuilt after the server drops it
STALL_STEPS = 8  # turns without an accepted experiment before Wonder is called in
UNCERTAIN_REVIEW_RATIO = 0.3
MIDPOINT_INFERRED_RATIO = 0.35  # unconfirmed share at half budget that calls Wonder in
META_WAIT_SECONDS = 150  # how long submit_result waits for Wonder's background inference
AUTO_TOOLS = ("get_overview", "passive_correlation", "geographic_prior", "consensus", "suggest_experiments")


@dataclass
class Event:
    t: float
    kind: str  # reasoning | message | tool_call | tool_result | experiment | hypothesis | review | result | error
    data: dict

    def to_dict(self) -> dict:
        return {"t": round(self.t, 2), "kind": self.kind, **self.data}


@dataclass
class Investigation:
    toolbox: ToolBox
    events: list[Event] = field(default_factory=list)
    steps: int = 0
    reviews: int = 0
    tokens: int = 0
    seconds: float = 0.0
    usage: dict = field(default_factory=dict)  # model -> token counts, for cost tracking
    stopped: bool = False

    @property
    def usage_summary(self) -> dict:
        return summarize(self.usage)

    @property
    def result(self) -> dict | None:
        return self.toolbox.result

    @property
    def experiments_used(self) -> int:
        return sum(r.cost for r in self.toolbox.engine.history)


class Investigator:
    def __init__(self, scenario: Scenario, budget: int | None = None, cfg: Settings = settings,
                 on_event: Callable[[Event], None] | None = None, client: MetaClient | None = None,
                 language: str = "en", t_offset: float = 0.0) -> None:
        self.cfg = cfg
        self.client = client or MetaClient(cfg)
        self.run = Investigation(ToolBox(scenario, budget or cfg.experiment_budget))
        self.on_event = on_event
        self.language = language
        self.t0 = time.perf_counter() - t_offset
        self.resumed_from: list[dict] | None = None
        self._meta_thread: threading.Thread | None = None
        self._lock = threading.Lock()  # usage is updated by Spark's loop and by Wonder's background inference

    def instructions(self) -> str:
        if self.language == "es":
            return SPARK_INSTRUCTIONS + ("\nWrite every message, note_hypothesis statement and summary in Spanish "
                                         "(node names and tool arguments stay as they are).")
        return SPARK_INSTRUCTIONS

    def stop(self) -> None:
        self.run.stopped = True

    def restore(self, events: list[dict]) -> None:
        """Rebuild experiments, notes and counters from a previous run's event log (no experiment is re-run)."""
        from gridxray.sim import ExperimentRecord

        tb = self.run.toolbox
        for e in events:
            kind = e.get("kind")
            if kind == "experiment" and e.get("accepted"):
                args = e.get("args", {})
                if args.get("kind") == "perturb_load" and args.get("node") in tb.id:
                    kw = float(args.get("delta_kw", 0))
                    drops = e.get("drop_pu_per_mw", {})
                    delta = {tb.id[n]: -v * kw / 1000 for n, v in drops.items() if n in tb.id}
                    delta |= {tb.id[n]: None for n in e.get("no_data", []) if n in tb.id}
                    action = {"type": "perturb_load", "node": tb.id[args["node"]], "delta_kw": kw}
                    tb.engine.history.append(ExperimentRecord(len(tb.engine.history) + 1, action, True, "ok", 1, delta, kw))
                elif args.get("kind") == "toggle_switch":
                    delta = {tb.id[n]: v for n, v in e.get("delta_pu", {}).items() if n in tb.id}
                    action = {"type": "toggle_switch", "switch_id": args.get("switch_id")}
                    tb.engine.history.append(ExperimentRecord(len(tb.engine.history) + 1, action, True, "restored", 1, delta))
            elif kind == "hypothesis":
                tb.notes.append({"statement": e.get("statement"), "confidence": e.get("confidence"), "nodes": e.get("nodes", [])})
            elif kind == "review":
                self.run.reviews += 1
            elif kind == "meta_inference" and e.get("edges"):
                from gridxray.tools.reconstruct import Candidate

                tb.meta_tree = Candidate({x["child"]: x["parent"] for x in e["edges"]},
                                         {x["child"]: x["basis"] for x in e["edges"]})
                self._meta_thread = threading.Thread()  # already done: never start it again
            elif kind == "usage":
                self.run.usage = {m: {k: v for k, v in u.items() if k != "cost_usd"} for m, u in e.get("by_model", {}).items()}
        self.run.steps = sum(1 for e in events if e.get("kind") in ("message", "reasoning"))
        self.resumed_from = events

    # ------------------------------------------------------------ events

    def emit(self, kind: str, **data: Any) -> None:
        ev = Event(time.perf_counter() - self.t0, kind, data)
        self.run.events.append(ev)
        if self.on_event:
            self.on_event(ev)

    def add_usage(self, model: str, usage: Any) -> None:
        with self._lock:
            self.run.tokens += usage.total_tokens if usage else 0
            add_usage(self.run.usage, model, usage)
            summary = self.run.usage_summary
        self.emit("usage", **summary)

    # ------------------------------------------------------------ Muse Wonder

    def review(self, reason: str, trigger: str) -> str:
        if self.run.reviews >= self.cfg.max_wonder_reviews:
            return "Review limit reached: continue with your best judgement."
        tb = self.run.toolbox
        dossier = {
            "reason": reason,
            "trigger": trigger,
            "overview": tb.t_get_overview(),
            "evidence": tb.t_get_evidence(),
            "candidate": tb.t_infer_tree(),
            "spark_notes": tb.notes[-6:],
            "experiments": [{"id": r.id, "action": r.action, "accepted": r.accepted, "message": r.message}
                            for r in tb.engine.history],
        }
        self.emit("review_started", trigger=trigger, reason=reason)
        wonder_rules = WONDER_INSTRUCTIONS + ("\nAnswer in Spanish (node names stay as they are)." if self.language == "es" else "")
        resp = self.client.respond(self.cfg.wonder_model, dumps(dossier), instructions=wonder_rules,
                                   reasoning_effort=self.cfg.wonder_reasoning_effort)
        self.run.reviews += 1
        self.add_usage(self.cfg.wonder_model, resp.usage)
        advice = resp.output_text.strip()
        self.emit("review", trigger=trigger, advice=advice, reasoning=reasoning_summary(resp))
        return advice

    def emit_candidate(self, why: str, parent: dict[int, int] | None = None, uncertain: list[int] | None = None) -> None:
        """Current best tree (node ids) so the UI can draw the reconstruction as it grows."""
        from gridxray.tools.reconstruct import best_tree

        tb = self.run.toolbox
        if parent is None:
            ens = tb.ensemble()
            physics = best_tree(tb.obs, tb.evidence())
            parent = ens.parent
            basis = {n: ("measured" if physics.basis.get(n) == "measured" and physics.parent[n] == parent[n]
                         else "uncertain" if n in ens.uncertain else "inferred") for n in parent}
        else:
            basis = {c: ("uncertain" if c in (uncertain or []) else "proposed") for c in parent}
        self.emit("candidate", why=why, edges=[{"child": c, "parent": p, "basis": basis[c]} for c, p in parent.items()])

    def meta_inference(self, trigger: str) -> dict:
        """Fourth method: Muse Wonder infers the topology from the raw experiment data (one ensemble vote).

        It runs in a background thread so Spark keeps experimenting meanwhile; submit_result waits for it.
        """
        if self._meta_thread is not None:
            return {"accepted": False, "message": "Muse Wonder's inference is already running or done; its vote "
                    "appears in consensus (meta_vote) when ready."}
        tb = self.run.toolbox
        ev = tb.evidence()  # the data as it stands now
        self.emit("review_started", trigger="meta inference", reason=f"Muse Wonder infers the topology from the raw data ({trigger})")

        def work() -> None:
            from gridxray.agent.meta_infer import meta_infer

            try:
                cand, info = meta_infer(self.client, self.cfg.wonder_model, self.cfg.meta_infer_effort, tb.obs, ev, self.language)
            except Exception as e:  # noqa: BLE001 - the other three methods still vote
                self.emit("error", message=f"Muse Wonder's inference failed ({type(e).__name__}); continuing without its vote.")
                return
            self.add_usage(self.cfg.wonder_model, info.pop("usage"))
            tb.meta_tree = cand
            self.emit("meta_inference", nodes_answered=info["nodes_answered"], uncertain=info["uncertain"],
                      rationale=info["rationale"], reasoning=info["reasoning"], experiments=len(ev.sens),
                      edges=[{"child": c, "parent": p, "basis": cand.basis[c]} for c, p in cand.parent.items()])

        self._meta_thread = threading.Thread(target=work, name="meta-inference", daemon=True)
        self._meta_thread.start()
        return {"accepted": True, "running_in_background": True,
                "hint": "Keep experimenting; its tree joins consensus (meta_vote: true) when ready."}

    def wait_meta(self, timeout: float = META_WAIT_SECONDS) -> None:
        end = time.monotonic() + timeout
        while (self._meta_thread is not None and self._meta_thread.is_alive() and not self.run.stopped
               and time.monotonic() < end):
            self._meta_thread.join(0.5)

    # ------------------------------------------------------------ tool dispatch

    def dispatch(self, name: str, raw_args: str) -> dict:
        tb = self.run.toolbox
        try:
            args = json.loads(raw_args or "{}")
        except json.JSONDecodeError as e:
            return {"error": f"invalid JSON arguments: {e}"}
        self.emit("tool_call", tool=name, args=args)
        try:
            if name == "meta_inference":
                out = self.meta_inference("requested by Spark")
                self.emit("tool_result", tool=name, ok=True, output=out)
                return out
            if name == "request_review":
                return {"reviewer_advice": self.review(args.get("reason", ""), "requested by Spark")}
            if name == "submit_result":
                uncertain = len(args.get("uncertain", []))
                total = max(1, len(tb.obs.nodes))
                self.wait_meta()  # let Wonder's vote count before the consensus tree is final
                if (uncertain / total > UNCERTAIN_REVIEW_RATIO and self.run.reviews == 0
                        and tb.engine.remaining > 0):
                    advice = self.review(f"Spark wants to close with {uncertain}/{total} uncertain edges.",
                                         "before closing with many uncertain edges")
                    return {"accepted": False, "reviewer_advice": advice,
                            "hint": "Consider the reviewer's plan, then submit again."}
            out = tb.call(name, args)
        except ToolError as e:
            out = {"error": str(e)}
        except Exception as e:  # noqa: BLE001 - surface any tool failure to the model, keep going
            out = {"error": f"{type(e).__name__}: {e}"}
        if name == "run_experiment":
            self.emit("experiment", args=args, **out)
            if out.get("accepted"):
                self.emit_candidate("after experiment")
        elif name == "run_experiments" and "results" in out:
            for r in out["results"]:
                self.emit("experiment", **({"message": r.get("error", "")} | r))
            if any(r.get("accepted") for r in out["results"]):
                self.emit_candidate("after experiments")
        elif name == "note_hypothesis":
            self.emit("hypothesis", **args)
        elif name == "submit_result" and out.get("accepted"):
            self.emit_candidate("final proposal", tb.result["parent"], tb.result["uncertain"])
            self.emit("result", summary=args.get("summary", ""), uncertain=args.get("uncertain", []))
        self.emit("tool_result", tool=name, ok="error" not in out, output=out)  # full audit trail of what the AI saw
        return out

    def fallback_result(self, why: str) -> None:
        """Close with the best evidence-backed tree, flagging every inferred edge as uncertain."""
        from gridxray.tools.reconstruct import best_tree

        tb = self.run.toolbox
        cand = best_tree(tb.obs, tb.evidence())
        uncertain = [c for c, b in cand.basis.items() if b == "inferred"]
        tb.result = {"parent": cand.parent, "uncertain": uncertain, "summary": f"Automatic close ({why})."}
        self.emit_candidate("final proposal", cand.parent, uncertain)
        self.emit("result", summary=tb.result["summary"], uncertain=[tb.name[c] for c in uncertain])

    def resume_message(self, pending: list[dict] | str) -> str:
        """State summary that lets Spark continue in a fresh conversation."""
        tb = self.run.toolbox
        if isinstance(pending, list):
            last = [o.get("output") for o in pending if o.get("type") == "function_call_output"]
            extra = [o.get("content") for o in pending if o.get("role") == "user"]
        else:
            last, extra = [], [pending]
        state = {
            "overview": tb.t_get_overview(),
            "evidence": tb.t_get_evidence(),
            "candidate": tb.t_infer_tree(),
            "your_notes": tb.notes,
            "experiments": [{"id": r.id, "action": r.action, "accepted": r.accepted, "message": r.message}
                            for r in tb.engine.history],
            "last_tool_results": last,
        }
        return ("The conversation state was lost on the server, so it is being restored. You are in the middle "
                "of this investigation; continue from here (do not repeat experiments already done).\n"
                + dumps(state) + ("\n" + "\n".join(str(x) for x in extra if x) if extra else ""))

    def first_look(self) -> dict:
        """The free, no-budget first step, computed before Spark's first turn and handed to it directly."""
        tb = self.run.toolbox
        out = {}
        for name in AUTO_TOOLS:
            self.emit("tool_call", tool=name, args={}, auto=True)
            out[name] = tb.call(name, {})
            self.emit("tool_result", tool=name, ok=True, output=out[name], auto=True)
        return out

    # ------------------------------------------------------------ main loop

    def investigate(self) -> Investigation:
        tb = self.run.toolbox
        n = len(tb.obs.nodes)
        inputs: str | list[dict] = ""
        if self.resumed_from is not None:
            inputs = self.resume_message("The investigation service restarted; continue where you left off.")
        prev: str | None = None
        last_experiment_step = 0
        nudges = 0
        recoveries = 0
        if self.resumed_from is None:
            self.emit("started", budget=tb.engine.budget, nodes=n, spark=self.cfg.spark_model, wonder=self.cfg.wonder_model)
            inputs = initial_task(tb.engine.budget, n, dumps(self.first_look()))
            self.emit_candidate("initial guess")
        else:
            self.emit("resumed", message=f"Investigation resumed: {self.run.experiments_used} experiments restored, "
                      f"{tb.engine.remaining} left in the budget.")
            self.emit_candidate("restored")
        while self.run.steps < self.cfg.max_agent_steps and tb.result is None and not self.run.stopped:
            self.run.steps += 1
            try:
                resp = self.client.respond(self.cfg.spark_model, inputs, instructions=self.instructions(), tools=TOOLS,
                                           previous_response_id=prev, reasoning_effort=self.cfg.spark_reasoning_effort)
            except openai.APITimeoutError:
                self.emit("error", message="Muse Spark did not answer in time; closing with the evidence-backed tree.")
                self.fallback_result("model timeout")
                break
            except openai.BadRequestError as e:
                if prev is None or "referenced response" not in str(e) or recoveries >= MAX_RECOVERIES:
                    raise
                recoveries += 1
                self.emit("recovered", message="Conversation state expired on the server; restored from the investigation log.")
                prev, inputs = None, self.resume_message(inputs)
                continue
            prev = resp.id
            self.add_usage(self.cfg.spark_model, resp.usage)
            if self.run.stopped:  # stopped while Spark was thinking: do not act on its answer
                break
            if summary := reasoning_summary(resp):
                self.emit("reasoning", text=summary)
            if text := resp.output_text.strip():
                self.emit("message", text=text)

            calls = [item for item in resp.output if item.type == "function_call"]
            if not calls:
                nudges += 1
                if nudges > 3:
                    self.emit("error", message="Spark stopped calling tools without submitting.")
                    break
                inputs = [{"role": "user", "content": "Continue the investigation with the tools. "
                           "Call submit_result with every node's parent when you are done."}]
                continue

            outputs: list[dict] = []
            for c in calls:
                if self.run.stopped:
                    break
                out = self.dispatch(c.name, c.arguments)
                if out.get("accepted") or any(r.get("accepted") for r in out.get("results", [])):
                    last_experiment_step = self.run.steps
                outputs.append({"type": "function_call_output", "call_id": c.call_id, "output": dumps(out)})
            if tb.result is not None or self.run.stopped:
                break

            # Wonder's own inference starts by itself at half budget and runs while Spark keeps going
            if self._meta_thread is None and self.run.experiments_used >= max(2, tb.engine.budget // 2):
                self.meta_inference("half the budget spent")

            # orchestrator escalation: half the budget is spent and much of the tree is still unconfirmed
            if (self.run.reviews == 0 and tb.engine.remaining > 0
                    and self.run.experiments_used >= max(2, tb.engine.budget // 2)):
                from gridxray.tools.reconstruct import best_tree

                cand = best_tree(tb.obs, tb.evidence())
                share = sum(1 for b in cand.basis.values() if b == "inferred") / max(1, len(cand.basis))
                if share > MIDPOINT_INFERRED_RATIO:
                    advice = self.review(f"Half the budget is spent and {share:.0%} of the connections are still "
                                         "unconfirmed. Where should the remaining experiments go?", "midpoint review")
                    outputs.append({"role": "user", "content": f"Second-opinion review from Muse Wonder:\n{advice}"})

            # orchestrator escalation: progress has stalled
            if (self.run.steps - last_experiment_step >= STALL_STEPS and tb.engine.remaining > 0
                    and self.run.reviews < self.cfg.max_wonder_reviews):
                advice = self.review("No accepted experiment in the last turns.", "investigation stalled")
                outputs.append({"role": "user", "content": f"Second-opinion review from Muse Wonder:\n{advice}"})
                last_experiment_step = self.run.steps
            if tb.engine.remaining <= 0:
                outputs.append({"role": "user", "content": "The experiment budget is exhausted. "
                                "Check your hypothesis and call submit_result now."})
            inputs = outputs

        if not self.run.stopped:
            self.wait_meta()  # its usage and vote belong to this run
        if self.run.stopped:
            self.emit("stopped", message="Investigation stopped by the user.")
        elif tb.result is None and tb.engine.history:
            self.fallback_result("step limit reached")
        self.run.seconds = time.perf_counter() - self.t0
        return self.run
