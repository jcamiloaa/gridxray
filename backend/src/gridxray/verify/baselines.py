"""Non-AI reference procedures that GridXray's agents are measured against."""

from dataclasses import dataclass

import numpy as np

from gridxray.lab import Scenario
from gridxray.sim import ExperimentEngine
from gridxray.tools.reconstruct import (
    MAX_HOP,
    Candidate,
    Evidence,
    best_tree,
    infer_tree,
    manhattan,
)


@dataclass
class BaselineResult:
    name: str
    candidate: Candidate
    experiments: int


def geographic(s: Scenario) -> BaselineResult:
    """GIS + one voltage snapshot: each kiosk hangs from its most upstream-looking neighbour."""
    return BaselineResult("geographic", infer_tree(s.observable()), 0)


def exhaustive(s: Scenario, delta_kw: float = 2000.0) -> BaselineResult:
    """Perturb every secondary substation once, then reconstruct from the full sensitivity data."""
    engine = ExperimentEngine(s, budget=10_000)
    for n in s.node_ids:
        for d in (delta_kw, delta_kw / 2, delta_kw / 4):  # back off if limits are hit
            if engine.perturb_load(n, d).accepted:
                break
    ev = Evidence.from_records(engine.history)
    used = sum(r.cost for r in engine.history)
    return BaselineResult("exhaustive", best_tree(s.observable(), ev), used)


def heuristic(s: Scenario, budget: int, delta_kw: float = 2000.0) -> BaselineResult:
    """Same budget as the agent, no AI: probe the farthest blocks first, then a fixed random sample."""
    import random

    order = sorted(s.node_ids, key=lambda n: -s.location[n][0])
    k = min(budget, len(order))
    probes = order[: k // 2] + random.Random(s.seed).sample(order[k // 2:], k - k // 2)
    engine = ExperimentEngine(s, budget=k)
    for n in probes:
        engine.perturb_load(n, delta_kw, 20)
    used = sum(r.cost for r in engine.history)
    return BaselineResult("heuristic", best_tree(s.observable(), Evidence.from_records(engine.history)), used)


def passive(s: Scenario) -> BaselineResult:
    """24 hourly snapshots: neighbouring kiosks whose voltages move together share a feeder (Chow-Liu style)."""
    obs = s.observable()
    engine = ExperimentEngine(s)
    series = {n: [] for n in s.metered}
    for h in range(24):
        for n, r in engine.snapshot(h).items():
            series[n].append(r["vm_pu"] if r["vm_pu"] is not None else np.nan)
    metered = [n for n in s.metered if np.isfinite(series[n]).sum() >= 12]
    loc = {n.id: n.location for n in obs.nodes}
    mean_v = {n: float(np.nanmean(series[n])) for n in metered}

    def corr(a: int, b: int) -> float:
        x, y = np.array(series[a]), np.array(series[b])
        ok = np.isfinite(x) & np.isfinite(y)
        if ok.sum() <= 3 or np.std(x[ok]) == 0 or np.std(y[ok]) == 0:
            return 0.0  # a stuck meter carries no information
        return float(np.corrcoef(x[ok], y[ok])[0, 1])

    # maximum-correlation spanning forest among nearby metered kiosks, grown from the
    # highest-voltage kiosks next to the substation
    parent: dict[int, int] = {}
    root = obs.substations[0].id
    heads = [n for n in metered if loc[n][0] == 0]
    tree = set(heads)
    for h in heads:
        parent[h] = root
    remaining = set(metered) - tree
    while remaining:
        best = None
        for a in tree:
            for b in remaining:
                if manhattan(loc[a], loc[b]) <= MAX_HOP and mean_v[a] >= mean_v[b] - 0.0005:
                    score = corr(a, b) - 0.02 * manhattan(loc[a], loc[b])
                    if best is None or score > best[0]:
                        best = (score, a, b)
        if best is None:
            break
        _, a, b = best
        parent[b] = a
        tree.add(b)
        remaining.discard(b)
    # everything else (unmetered or isolated) from the geographic rule
    geo = infer_tree(obs)
    for n in obs.nodes:
        parent.setdefault(n.id, geo.parent[n.id])
    basis = {n: ("measured" if n in metered else "inferred") for n in parent}
    return BaselineResult("passive", Candidate(parent, basis), 0)
