"""Orchestrates the investigation: Muse Spark runs the tool loop, Muse Wonder reviews on escalation."""

import json
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
MIDPOINT_INFERRED_RATIO = 0.35  # unconfirmed share at half budget that calls Wonder in  # share of uncertain edges that triggers a review before closing


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
        self.run.tokens += resp.usage.total_tokens if resp.usage else 0
        add_usage(self.run.usage, self.cfg.wonder_model, resp.usage)
        self.emit("usage", **self.run.usage_summary)
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

    def meta_inference(self) -> dict:
        """Fourth method: Muse Wonder infers the topology from the raw experiment data (one ensemble vote)."""
        from gridxray.agent.meta_infer import meta_infer

        tb = self.run.toolbox
        self.emit("review_started", trigger="meta inference", reason="Muse Wonder infers the topology from the raw data")
        cand, info = meta_infer(self.client, self.cfg.wonder_model, self.cfg.wonder_reasoning_effort, tb.obs,
                                tb.evidence(), self.language)
        add_usage(self.run.usage, self.cfg.wonder_model, info.pop("usage"))
        self.emit("usage", **self.run.usage_summary)
        tb.meta_tree = cand
        self.emit("meta_inference", nodes_answered=info["nodes_answered"], uncertain=info["uncertain"],
                  rationale=info["rationale"], reasoning=info["reasoning"],
                  edges=[{"child": c, "parent": p, "basis": cand.basis[c]} for c, p in cand.parent.items()])
        return {"accepted": True, "nodes_answered": info["nodes_answered"], "rationale": info["rationale"],
                "hint": "Its tree now votes in `consensus`."}

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
                return self.meta_inference()
            if name == "request_review":
                return {"reviewer_advice": self.review(args.get("reason", ""), "requested by Spark")}
            if name == "submit_result":
                uncertain = len(args.get("uncertain", []))
                total = max(1, len(tb.obs.nodes))
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

    # ------------------------------------------------------------ main loop

    def investigate(self) -> Investigation:
        tb = self.run.toolbox
        n = len(tb.obs.nodes)
        inputs: str | list[dict] = initial_task(tb.engine.budget, n)
        if self.resumed_from is not None:
            inputs = self.resume_message("The investigation service restarted; continue where you left off.")
        prev: str | None = None
        last_experiment_step = 0
        nudges = 0
        recoveries = 0
        if self.resumed_from is None:
            self.emit("started", budget=tb.engine.budget, nodes=n, spark=self.cfg.spark_model, wonder=self.cfg.wonder_model)
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
            self.run.tokens += resp.usage.total_tokens if resp.usage else 0
            add_usage(self.run.usage, self.cfg.spark_model, resp.usage)
            self.emit("usage", **self.run.usage_summary)
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
                out = self.dispatch(c.name, c.arguments)
                if c.name == "run_experiment" and out.get("accepted"):
                    last_experiment_step = self.run.steps
                outputs.append({"type": "function_call_output", "call_id": c.call_id, "output": dumps(out)})
            if tb.result is not None:
                break

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

        if self.run.stopped:
            self.emit("stopped", message="Investigation stopped by the user.")
        elif tb.result is None and tb.engine.history:
            self.fallback_result("step limit reached")
        self.run.seconds = time.perf_counter() - self.t0
        return self.run
