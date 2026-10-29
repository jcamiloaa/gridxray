"""The initial plan (the utility's drawing of the network) and the Planning agent that weighs it.

A utility rarely starts from nothing: it has a GIS drawing, sometimes current, often years old, sometimes
simply wrong. `make_plan` produces that drawing from the hidden truth in a controlled way:

- "current": the real wiring, drawn recently;
- "old": drawn years ago; part of the network was re-fed since, and the newest substations are missing;
- "errors": recent, but a share of the connections were drawn wrong.

The Planning agent (Muse Spark in a planner role) checks the plan against what can be observed for free
(geography, voltage profile, 24 h correlations), says how far to trust it, proposes where to start and,
in autonomous mode, how many experiments the investigation needs.
"""

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

import numpy as np

from gridxray.lab import Scenario

PLAN_KINDS = ("none", "current", "old", "errors")
DEFAULT_AGE_DAYS = {"current": 90, "old": 9 * 365, "errors": 400}
MIN_BUDGET, MAX_BUDGET = 3, 40

PLANNER_INSTRUCTIONS = """\
You are GridXray's planning engineer. Before the investigation starts you review the utility's drawing of a
medium-voltage network (the initial plan, if any) against what can be observed for free, and you plan the work.
The plan may be current, old (the network changed since it was drawn) or wrong. Its date and today's date are given.
Free checks are provided: how many drawn connections fit the city geography (sections join blocks at most two
streets apart), the voltage profile (a child should not read higher than its parent beyond noise) and the 24 h
meter correlations. Weigh them with the plan's age, and with how reliable each check is: geography and the voltage
profile catch only gross drawing errors; the 24 h correlation tree is itself only about half right on networks with
several feeders, so low agreement with it is weak evidence against a plan. Even an old plan is usually right on most
connections that did not change; trust it moderately unless several checks fail together.
Return ONLY JSON:
{"trust_in_plan": 0..1, "budget": <integer experiments the investigation needs, 3..40>,
 "priorities": ["<node names to test first, up to 8>"], "strategy": "<two sentences for the lead investigator>",
 "reasoning": "<three sentences: what the checks say and why this budget>"}
Size the budget to the uncertainty: roughly one experiment per node you cannot place from the evidence, fewer when
a trustworthy plan and full metering leave little to resolve, more with an old or inconsistent plan, missing
meters or many feeders."""


MAX_EXTRA = 10  # experiments the planner may add after a field failure

REPLAN_INSTRUCTIONS = """\
You are GridXray's planning engineer, called back in the middle of an investigation: the meters show that the real
network changed (a switch was operated or equipment failed). Earlier experiments were set aside because they describe
the old network and NO LONGER COUNT: what was confirmed before the change must be confirmed again. You get how many
experiments still count, how many substations are confirmed by them, how many are not, and the budget left.
Rules: a meter that went silent is a failure in the field: recommend a crew, and count that a crew visit uses one
experiment of the budget. If the budget left (minus the crew, if you recommend one) cannot re-confirm the
unconfirmed substations in the affected area (roughly one experiment per unconfirmed substation there, at least the
suspect sites), add the difference; add none only when the budget left clearly covers it. Return ONLY JSON:
{"extra_experiments": <integer 0..10>, "send_crew": true|false, "priorities": ["<node names to re-test first, up to 6>"],
 "reasoning": "<two sentences: what changed and why this many extra experiments>"}"""


@dataclass
class Plan:
    kind: str  # current | old | errors
    drawn_on: str  # ISO date of the drawing
    parent: dict[int, int]  # drawn child -> parent (nodes missing from the drawing are absent)
    missing: list[int] = field(default_factory=list)  # substations built after the drawing

    def age_years(self, today: date | None = None) -> float:
        today = today or date.today()
        return round((today - date.fromisoformat(self.drawn_on)).days / 365.25, 1)

    def to_dict(self) -> dict:
        return asdict(self)


def true_parent(s: Scenario) -> dict[int, int]:
    """The real radial tree: each secondary substation's feeding node, found from the substations outwards."""
    adj: dict[int, list[int]] = {}
    for a, b in s.true_edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    parent, queue, seen = {}, list(s.roots), set(s.roots)
    while queue:
        cur = queue.pop(0)
        for nxt in sorted(adj.get(cur, [])):
            if nxt not in seen:
                seen.add(nxt)
                parent[nxt] = cur
                queue.append(nxt)
    return parent


def _plausible_parent(s: Scenario, child: int, parent: dict[int, int], rng: np.random.Generator,
                      reach: int = 2) -> int | None:
    """A wrong but believable feeding node: within `reach` blocks, and not below the child (no loops)."""
    below, frontier = {child}, [child]
    while frontier:
        cur = frontier.pop()
        for c, p in parent.items():
            if p == cur and c not in below:
                below.add(c)
                frontier.append(c)
    here = s.location.get(child)
    options = [n for n in [*s.node_ids, *s.roots] if n not in below and n != parent.get(child) and here and s.location.get(n)
               and abs(s.location[n][0] - here[0]) + abs(s.location[n][1] - here[1]) <= reach]
    return int(rng.choice(options)) if options else None


def make_plan(s: Scenario, kind: str, drawn_on: str | None = None, today: date | None = None) -> Plan | None:
    """The drawing the utility starts from (None when it has none). Deterministic per scenario and kind."""
    if kind not in PLAN_KINDS or kind == "none":
        return None
    today = today or date.today()
    drawn = drawn_on or (today - timedelta(days=DEFAULT_AGE_DAYS[kind])).isoformat()
    rng = np.random.default_rng(s.seed * 7919 + PLAN_KINDS.index(kind))
    parent = true_parent(s)
    nodes = sorted(parent)
    missing: list[int] = []
    if kind == "old":
        # the newest substations are leaves added after the drawing; part of the network was re-fed since
        leaves = [n for n in nodes if n not in parent.values()]
        missing = sorted(int(n) for n in rng.choice(leaves, size=max(1, len(leaves) // 6), replace=False)) if leaves else []
        for n in missing:
            parent.pop(n)
        changed = 0.22
    elif kind == "errors":
        changed = 0.3
    else:
        changed = 0.0
    # a plan "with errors" or "old" always differs somewhere, even on a tiny network
    want = max(1, round(changed * len(parent))) if changed else 0
    done = 0
    for reach in (2, 4, 99):  # prefer believable neighbours, widen only if none is left
        for n in rng.permutation(nodes):
            n = int(n)
            if done >= want:
                break
            if n in parent and parent[n] == true_parent(s).get(n):
                alt = _plausible_parent(s, n, parent, rng, reach)
                if alt is not None:
                    parent[n] = alt
                    done += 1
        if done >= want:
            break
    return Plan(kind, drawn, parent, missing)


def plan_checks(s: Scenario, plan: Plan, readings: dict[int, dict], passive_tree: dict[int, int] | None) -> dict:
    """Free consistency checks of the drawing against what can be observed (no experiment, no truth)."""
    geo = volt = corr = 0
    total = len(plan.parent)
    for c, p in plan.parent.items():
        a, b = s.location.get(c), s.location.get(p)
        geo += bool(a and b and abs(a[0] - b[0]) + abs(a[1] - b[1]) <= 2)
        vc, vp = (readings.get(c) or {}).get("vm_pu"), (readings.get(p) or {}).get("vm_pu")
        volt += vc is None or vp is None or vc <= vp + 0.0015
        corr += bool(passive_tree and passive_tree.get(c) == p)
    return {"drawn_connections": total, "fit_geography": geo, "fit_voltage_profile": volt,
            "agree_with_24h_correlation": corr, "substations_missing_from_plan": len(plan.missing)}


def plan_accuracy(s: Scenario, plan: Plan) -> dict:
    """How right the drawing was against the real network (for the report, never for the agents)."""
    truth = true_parent(s)
    correct = sum(1 for c, p in plan.parent.items() if truth.get(c) == p)
    return {"correct": correct, "total": len(truth), "missing": len(plan.missing)}


def parse_plan_decision(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    try:
        out = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        out = {}
    try:
        asked = int(out.get("budget") or 0)
        out["budget"] = int(min(MAX_BUDGET, max(MIN_BUDGET, asked))) if asked > 0 else 0  # 0: no usable number
    except (TypeError, ValueError):
        out["budget"] = 0
    try:
        out["trust_in_plan"] = round(min(1.0, max(0.0, float(out.get("trust_in_plan", 0)))), 2)
    except (TypeError, ValueError):
        out["trust_in_plan"] = 0.0
    return out


def fallback_budget(n_nodes: int, metered: int, trust: float) -> int:
    """When the planner gives no usable number: about half the nodes, more with weak plans or few meters."""
    need = n_nodes * (0.6 - 0.3 * trust) + (n_nodes - metered) * 0.3
    return int(min(MAX_BUDGET, max(MIN_BUDGET, round(need))))


def parse_replan(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    try:
        out = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        out = {}
    try:
        out["extra_experiments"] = int(min(MAX_EXTRA, max(0, int(out.get("extra_experiments") or 0))))
    except (TypeError, ValueError):
        out["extra_experiments"] = 0
    out["send_crew"] = bool(out.get("send_crew"))
    return out
