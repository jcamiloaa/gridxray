"""The investigation tools Muse Spark can call, with their JSON schemas (Responses API format).

The ToolBox holds the experiment engine, but every output is built from the observable
view and from experiment results only: the true topology never leaves the simulator.
Nodes are referred to by name (e.g. "SS-07"); substations by their name too.
"""

import json
from typing import Any

from gridxray.lab import Scenario
from gridxray.sim import ExperimentEngine
from gridxray.tools.hybrid import Passive, consensus, passive_correlation
from gridxray.tools.reconstruct import (
    Evidence,
    best_tree,
    check_tree,
    infer_tree,
    predicted_sensitivity,
)


def _fn(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "function", "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required or [],
                       "additionalProperties": False},
    }


CHANGES = {
    "type": "array",
    "description": "Corrections to the current infer_tree candidate: only the nodes whose parent you change.",
    "items": {"type": "object", "properties": {"child": {"type": "string"}, "parent": {"type": "string"}},
              "required": ["child", "parent"], "additionalProperties": False},
}

EDGE_LIST = {
    "type": "array",
    "description": "One entry per secondary substation: the node and the node (or substation) that feeds it.",
    "items": {"type": "object", "properties": {"child": {"type": "string"}, "parent": {"type": "string"}},
              "required": ["child", "parent"], "additionalProperties": False},
}

MAX_BATCH = 5
DEFAULT_DELTA_KW = 1500.0

TOOLS: list[dict] = [
    _fn("get_overview",
        "Everything the utility knows before experimenting: each secondary substation's city block "
        "(column, row), meter reading, mount type and devices; the substation(s); the switches and "
        "their documented (possibly outdated) state; the remaining experiment budget.", {}),
    _fn("run_experiment",
        "Run one virtual experiment on the physics simulator (costs 1 budget unit if accepted). "
        "perturb_load adds delta_kw at a node and returns every meter's voltage change per MW: "
        "nodes sharing more of the path from the substation drop more. toggle_switch temporarily "
        "operates a switch (by id) and returns the voltage changes. Experiments that would break "
        "operating limits are rejected for free.",
        {"kind": {"type": "string", "enum": ["perturb_load", "toggle_switch"]},
         "node": {"type": "string", "description": "Node name, for perturb_load."},
         "delta_kw": {"type": "number", "description": "Load change in kW (±3000). Bigger = clearer signal."},
         "switch_id": {"type": "integer", "description": "Switch id, for toggle_switch."},
         "repeats": {"type": "integer", "description": "Readings averaged per state (default 10, max 40). More = less noise."}},
        ["kind"]),
    _fn("run_experiments",
        "Run several virtual experiments in one call (up to 5; each accepted one costs 1 budget unit), "
        "e.g. the top suggestions. Same fields as run_experiment per item. Returns every result plus the "
        "updated consensus, so you can plan the next batch without extra calls. Prefer this to one-by-one.",
        {"experiments": {"type": "array", "maxItems": MAX_BATCH, "items": {
            "type": "object", "additionalProperties": False, "required": ["kind"],
            "properties": {"kind": {"type": "string", "enum": ["perturb_load", "toggle_switch"]},
                           "node": {"type": "string"},
                           "delta_kw": {"type": "number", "description": f"kW to add (default {DEFAULT_DELTA_KW:.0f})."},
                           "switch_id": {"type": "integer"}, "repeats": {"type": "integer"}}}}},
        ["experiments"]),
    _fn("get_evidence",
        "Summary of all load experiments so far: for each perturbed node, its electrical depth "
        "(pu per MW) and the metered nodes the data places downstream of it. Also flags meters "
        "that never respond (possibly faulty).", {}),
    _fn("infer_tree",
        "Deterministic best guess of the full topology from the evidence so far. Edges backed by "
        "experiments are 'measured'; the rest are 'inferred' from geography and voltage and need "
        "confirmation. Use it as a starting point, not as the answer.",
        {"tolerance": {"type": "number", "description": "Matching tolerance in pu per MW (default 0.00012). Raise it when data is noisy."}}),
    _fn("passive_correlation",
        "Traditional machine learning on 24 h of historical meter data (no experiment, free): feeder groups "
        "from hierarchical clustering of voltage patterns, and a Chow-Liu maximum-correlation tree.", {}),
    _fn("geographic_prior",
        "Non-AI prior from GIS and one voltage snapshot: each node hangs from its most upstream-looking neighbour.", {}),
    _fn("meta_inference",
        "Ask the Meta model (Muse Wonder) to infer the full topology directly from the raw experiment data. "
        "It runs in the background while you keep experimenting (the orchestrator also starts it at half "
        "budget); its answer joins consensus as one vote when ready.", {}),
    _fn("consensus",
        "Ensemble of all methods (physics from experiments, correlation ML, geography and the Meta model's own "
        "inference when available): chosen parent per node, how many methods agree, and the nodes where they "
        "disagree. Disagreements are where to experiment next and what to report as uncertain.", {}),
    _fn("suggest_experiments",
        "Ranked candidates for the next load perturbation: metered nodes not yet probed, far from the substation, "
        "whose path still has many unconfirmed (inferred) connections. A starting point: you decide.", {}),
    _fn("check_hypothesis",
        "Validate a topology hypothesis and measure how well it explains the experiments: returns whether it "
        "is a valid radial tree, the mismatch per experiment and the worst nodes. Give either `changes` to the "
        "current infer_tree candidate (preferred: only the nodes you move) or a full `edges` list.",
        {"changes": CHANGES, "edges": EDGE_LIST}),
    _fn("compare_hypotheses",
        "Given two full hypotheses, find the load perturbation whose predicted voltage changes "
        "differ most between them: the most informative next experiment.",
        {"edges_a": EDGE_LIST, "edges_b": EDGE_LIST}, ["edges_a", "edges_b"]),
    _fn("note_hypothesis",
        "Record a hypothesis or conclusion in the investigation log (shown live to the engineer).",
        {"statement": {"type": "string"}, "nodes": {"type": "array", "items": {"type": "string"}},
         "confidence": {"type": "number", "description": "0 to 1."}},
        ["statement", "confidence"]),
    _fn("request_review",
        "Ask Muse Wonder, a second-opinion investigator, to review the evidence when several "
        "topologies still fit the data or you do not know how to proceed.",
        {"reason": {"type": "string"}}, ["reason"]),
    _fn("submit_result",
        "Finish the investigation with your final topology: the current infer_tree candidate plus your "
        "`changes` (preferred), or a full `edges` list. List the nodes whose parent you are not sure about.",
        {"changes": CHANGES, "edges": EDGE_LIST,
         "uncertain": {"type": "array", "items": {"type": "string"},
                       "description": "Child nodes whose parent you are unsure of."},
         "summary": {"type": "string"}},
        ["uncertain", "summary"]),
]


class ToolError(ValueError):
    pass


class ToolBox:
    def __init__(self, scenario: Scenario, budget: int = 20) -> None:
        self.engine = ExperimentEngine(scenario, budget=budget)
        self.obs = scenario.observable()
        self.name = {n.id: n.name for n in self.obs.nodes} | {s.id: s.name for s in self.obs.substations}
        self.id = {v: k for k, v in self.name.items()}
        self.tol = 1.2e-4
        self.result: dict | None = None
        self.notes: list[dict] = []
        self._passive: Passive | None = None
        self.meta_tree = None  # set by the orchestrator when the Meta model has inferred a tree

    # ------------------------------------------------------------ plumbing

    def call(self, name: str, args: dict[str, Any]) -> dict:
        fn = getattr(self, f"t_{name}", None)
        if fn is None:
            raise ToolError(f"unknown tool {name}")
        return fn(**args)

    def _node(self, name: str) -> int:
        if name not in self.id:
            raise ToolError(f"unknown node {name!r}")
        return self.id[name]

    def passive(self) -> Passive:
        if self._passive is None:  # historical hourly readings: no experiment, no budget
            series: dict[int, list] = {n: [] for n in self.engine.s.metered}
            for h in range(24):
                for n, r in self.engine.snapshot(h).items():
                    series[n].append(r["vm_pu"])
            self._passive = passive_correlation(self.obs, series)
        return self._passive

    def ensemble(self):
        return consensus(self.obs, self.evidence(), self.passive(), self.meta_tree)

    def _parents(self, edges: list[dict] | None = None, changes: list[dict] | None = None) -> dict[int, int]:
        """A full proposal from explicit edges, or the ensemble's tree with the given changes."""
        parent = {} if edges else dict(self.ensemble().parent)
        for e in (edges or []) + (changes or []):
            parent[self._node(e["child"])] = self._node(e["parent"])
        return parent

    def evidence(self, tol: float | None = None) -> Evidence:
        return Evidence.from_records(self.engine.history, tol or self.tol)

    # ------------------------------------------------------------ tools

    def t_get_overview(self) -> dict:
        devices = {d.node: f"{d.kind} {d.rating:.0f}{' kvar' if d.kind == 'capacitor' else ' kW'}" for d in self.obs.devices}
        return {
            "substations": [{"name": s.name, "block": s.location} for s in self.obs.substations],
            "nodes": [
                {"name": n.name, "block": n.location, "metered": n.metered, "mount": n.mount,
                 "vm_pu": self.obs.readings.get(n.id, {}).get("vm_pu") if n.metered else None,
                 "p_kw": self.obs.readings.get(n.id, {}).get("p_kw") if n.metered else None,
                 **({"device": devices[n.id]} if n.id in devices else {})}
                for n in self.obs.nodes
            ],
            "switches": [{"id": s.id, "kind": s.kind, "documented": "closed" if s.documented_closed else "open"}
                         for s in self.obs.switches if s.kind in ("tie", "sectionalizer", "recloser")],
            "hour": self.obs.hour,
            "budget_remaining": self.engine.remaining,
            "notes": "Blocks are city grid cells; line sections only join blocks at most 2 streets apart. "
                     "Voltage drops with electrical distance from the substation.",
        }

    def t_run_experiment(self, kind: str, node: str | None = None, delta_kw: float | None = None,
                         switch_id: int | None = None, repeats: int | None = None) -> dict:
        r = min(max(repeats or 10, 1), 40)
        if kind == "perturb_load":
            if node is None or delta_kw is None:
                raise ToolError("perturb_load needs node and delta_kw")
            rec = self.engine.perturb_load(self._node(node), float(delta_kw), r)
        elif kind == "toggle_switch":
            if switch_id is None:
                raise ToolError("toggle_switch needs switch_id")
            rec = self.engine.toggle_switch(int(switch_id), r)
        else:
            raise ToolError(f"unknown experiment kind {kind!r}")
        out: dict = {"experiment": rec.id, "accepted": rec.accepted, "message": rec.message,
                     "budget_remaining": self.engine.remaining}
        if rec.accepted:
            scale = -1000 / rec.delta_p_kw if rec.delta_p_kw else -1.0
            label = "drop_pu_per_mw" if rec.delta_p_kw else "delta_pu"
            rows = sorted(((self.name[n], round(dv * scale, 6)) for n, dv in rec.delta_vm.items() if dv is not None),
                          key=lambda x: -x[1])
            out[label] = dict(rows)
            out["no_data"] = [self.name[n] for n, dv in rec.delta_vm.items() if dv is None]
        return out

    def t_run_experiments(self, experiments: list[dict]) -> dict:
        if not experiments:
            raise ToolError("experiments is empty")
        results = []
        for args in experiments[:MAX_BATCH]:
            if args.get("kind") == "perturb_load" and args.get("delta_kw") is None:
                args = {**args, "delta_kw": DEFAULT_DELTA_KW}  # a forgotten size should not waste the batch
            try:
                results.append({"args": args, **self.t_run_experiment(**args)})
            except (ToolError, TypeError) as e:
                results.append({"args": args, "accepted": False, "error": str(e), "budget_remaining": self.engine.remaining})
            if self.engine.remaining <= 0:
                break
        return {"results": results, "budget_remaining": self.engine.remaining, "consensus": self.consensus_brief()}

    def consensus_brief(self) -> dict:
        """Where the methods still disagree: the short form returned after each batch."""
        c = self.ensemble()
        return {"uncertain": [self.name[n] for n in c.uncertain],
                "unanimous": sum(1 for n in c.parent if len(c.votes[n]) == 1), "total": len(c.parent),
                "meta_vote": self.meta_tree is not None}

    def t_get_evidence(self) -> dict:
        ev = self.evidence()
        silent = []
        for n in self.engine.s.metered:
            vals = [row[n] for row in ev.sens.values() if n in row]
            if len(vals) >= 2 and max(abs(v) for v in vals) < 2e-5:
                silent.append(self.name[n])
        return {
            "perturbed": {self.name[i]: {"depth_pu_per_mw": round(ev.depth[i], 6),
                                         "downstream": [self.name[j] for j in ev.downstream(i)]}
                          for i in ev.depth},
            "suspect_meters": silent,
            "experiments_done": sum(r.cost for r in self.engine.history),
            "budget_remaining": self.engine.remaining,
        }

    def t_infer_tree(self, tolerance: float | None = None) -> dict:
        # a custom tolerance applies to this call only, so it never silently shapes the final answer
        cand = best_tree(self.obs, self.evidence(float(tolerance) if tolerance else None))
        edges = [{"child": self.name[c], "parent": self.name[p], "basis": cand.basis[c]} for c, p in cand.parent.items()]
        inferred = [e["child"] for e in edges if e["basis"] == "inferred"]
        return {"edges": edges, "inferred_count": len(inferred), "measured_count": len(edges) - len(inferred),
                "inferred_children": inferred}

    def _edges(self, parent: dict[int, int]) -> list[dict]:
        return [{"child": self.name[c], "parent": self.name[p]} for c, p in sorted(parent.items(), key=lambda x: self.name[x[0]])]

    def t_passive_correlation(self) -> dict:
        p = self.passive()
        return {"feeder_groups": [[self.name[n] for n in g] for g in p.clusters],
                "chow_liu_tree": self._edges(p.tree.parent),
                "method": "hierarchical clustering + maximum-correlation spanning tree on 24 h detrended voltages"}

    def t_geographic_prior(self) -> dict:
        return {"tree": self._edges(infer_tree(self.obs).parent), "method": "GIS blocks + voltage snapshot"}

    def t_consensus(self) -> dict:
        c = self.ensemble()
        methods = sorted({m for v in c.votes.values() for ms in v.values() for m in ms})
        rows = [{"node": self.name[n], "parent": self.name[c.parent[n]], "agreement": round(c.agreement[n], 2),
                 **({"alternatives": {self.name[p]: ms for p, ms in c.votes[n].items() if p != c.parent[n]}}
                    if len(c.votes[n]) > 1 else {})}
                for n in sorted(c.parent, key=lambda x: self.name[x])]
        return {"methods": methods, "tree": rows, "uncertain": [self.name[n] for n in c.uncertain],
                "unanimous": sum(1 for n in c.parent if len(c.votes[n]) == 1), "total": len(c.parent)}

    def t_suggest_experiments(self) -> dict:
        ev = self.evidence()
        cand = best_tree(self.obs, ev)
        roots = {s.id for s in self.obs.substations}
        loc = {n.id: n.location for n in self.obs.nodes}

        def path(j: int) -> list[int]:
            out: list[int] = []
            while j not in roots and j in cand.parent and j not in out:
                out.append(j)
                j = cand.parent[j]
            return out

        probed = set(ev.depth)
        rows = []
        for j in self.engine.s.metered:
            if j in probed:
                continue
            p = path(j)
            inferred = sum(1 for n in p if cand.basis.get(n) == "inferred")
            rows.append((inferred, loc[j][0], -len(p), j, len(p)))
        rows.sort(reverse=True)
        return {"suggestions": [{"node": self.name[j], "unconfirmed_on_path": inf, "path_length": plen, "block": loc[j]}
                                for inf, _, _, j, plen in rows[:6]],
                "already_probed": [self.name[j] for j in probed],
                "budget_remaining": self.engine.remaining}

    def t_check_hypothesis(self, edges: list[dict] | None = None, changes: list[dict] | None = None) -> dict:
        parent = self._parents(edges, changes)
        problem = check_tree(self.obs, parent)
        if problem:
            return {"valid": False, "problem": problem}
        pred = predicted_sensitivity(self.obs, parent)
        ev = self.evidence()
        per_exp, worst = {}, {}
        for i, row in ev.sens.items():
            diffs = [row[j] - pred[i][j] for j in row if j in pred[i]]
            if not diffs:
                continue
            offset = sum(diffs) / len(diffs)  # common transformer drop
            res = {j: abs(row[j] - pred[i][j] - offset) for j in row if j in pred[i]}
            per_exp[self.name[i]] = round((sum(v * v for v in res.values()) / len(res)) ** 0.5, 6)
            for j, v in res.items():
                worst[j] = max(worst.get(j, 0.0), v)
        top = sorted(worst.items(), key=lambda x: -x[1])[:6]
        return {"valid": True, "rms_mismatch_by_experiment": per_exp,
                "worst_nodes": {self.name[j]: round(v, 6) for j, v in top},
                "hint": "Mismatch below ~0.0002 pu/MW is within noise and model error."}

    def t_compare_hypotheses(self, edges_a: list[dict], edges_b: list[dict]) -> dict:
        pa, pb = self._parents(edges_a), self._parents(edges_b)
        for p in (pa, pb):
            problem = check_tree(self.obs, p)
            if problem:
                return {"valid": False, "problem": problem}
        A, B = predicted_sensitivity(self.obs, pa), predicted_sensitivity(self.obs, pb)
        metered = set(self.engine.s.metered)
        scores = sorted(((sum(abs(A[i][j] - B[i][j]) for j in metered), i) for i in A), reverse=True)[:3]
        differ = sorted(self.name[c] for c in pa if pa[c] != pb.get(c))
        return {"edges_that_differ": differ,
                "best_experiments": [{"perturb": self.name[i], "expected_separation": round(s, 6)} for s, i in scores]}

    def t_note_hypothesis(self, statement: str, confidence: float, nodes: list[str] | None = None) -> dict:
        self.notes.append({"statement": statement, "confidence": confidence, "nodes": nodes or []})
        return {"recorded": True}

    def t_submit_result(self, uncertain: list[str], summary: str, edges: list[dict] | None = None,
                        changes: list[dict] | None = None) -> dict:
        parent = self._parents(edges, changes)
        problem = check_tree(self.obs, parent)
        if problem:
            return {"accepted": False, "problem": problem, "hint": "Fix the proposal and submit again."}
        self.result = {"parent": parent, "uncertain": [self._node(u) for u in uncertain if u in self.id],
                       "summary": summary}
        return {"accepted": True}

    # request_review is handled by the orchestrator (it calls Muse Wonder)


def dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), default=str)
