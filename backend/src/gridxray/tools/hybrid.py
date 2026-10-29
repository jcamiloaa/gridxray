"""Traditional AI and non-AI analyses that the Meta models combine (never competitors).

- passive_correlation: classic machine learning on 24 h of historical meter data
  (correlation of detrended voltages, hierarchical clustering into feeder groups and a
  Chow-Liu maximum-correlation spanning tree constrained to nearby blocks).
- geographic prior: GIS + one voltage snapshot.
- consensus: an ensemble that measures, node by node, how many methods agree on the parent.
All of them only use the observable view and experiment results.
"""

from collections import Counter
from dataclasses import dataclass

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

from gridxray.lab import ObservableGrid
from gridxray.tools.reconstruct import (
    MAX_HOP,
    Candidate,
    Evidence,
    best_tree,
    infer_tree,
    manhattan,
)


@dataclass
class Passive:
    tree: Candidate
    clusters: list[list[int]]
    corr: dict[tuple[int, int], float]


def passive_correlation(obs: ObservableGrid, series: dict[int, list[float | None]]) -> Passive:
    """Chow-Liu style tree and feeder clusters from hourly voltages (no experiments)."""
    loc = {n.id: n.location for n in obs.nodes}
    data = {n: np.array([np.nan if v is None else v for v in vals], dtype=float) for n, vals in series.items()}
    good = [n for n, x in data.items() if np.isfinite(x).sum() >= 12 and np.nanstd(x) > 0]
    if len(good) < 2:
        return Passive(infer_tree(obs), [], {})
    # remove the common daily shape so what remains is each node's own drop pattern
    mat = np.vstack([data[n] for n in good])
    common = np.nanmean(mat, axis=0)
    resid = {n: data[n] - common for n in good}

    def corr(a: int, b: int) -> float:
        x, y = resid[a], resid[b]
        ok = np.isfinite(x) & np.isfinite(y)
        if ok.sum() <= 3 or np.std(x[ok]) == 0 or np.std(y[ok]) == 0:
            return 0.0
        return float(np.corrcoef(x[ok], y[ok])[0, 1])

    pairs = {(a, b): corr(a, b) for i, a in enumerate(good) for b in good[i + 1:]}
    c = lambda a, b: pairs.get((a, b), pairs.get((b, a), 0.0))

    # feeder groups: average-linkage clustering on correlation distance
    dist = np.array([[0.0 if a == b else 1 - c(a, b) for b in good] for a in good])
    labels = fcluster(linkage(squareform(dist, checks=False), "average"), t=0.6, criterion="distance")
    clusters = [[n for n, lab in zip(good, labels, strict=True) if lab == k] for k in sorted(set(labels))]

    # Chow-Liu: maximum-correlation spanning tree among nearby blocks, grown from the busbar side
    mean_v = {n: float(np.nanmean(data[n])) for n in good}
    root = obs.substations[0].id
    geo = infer_tree(obs)
    parent: dict[int, int] = {}
    heads = [n for n in good if loc[n][0] == 0] or [max(good, key=lambda n: mean_v[n])]
    tree = set(heads)
    for h in heads:
        parent[h] = geo.parent.get(h, root) if loc[h][0] else root
    remaining = set(good) - tree
    while remaining:
        best = None
        for a in tree:
            for b in remaining:
                if manhattan(loc[a], loc[b]) <= MAX_HOP and mean_v[a] >= mean_v[b] - 0.0005:
                    score = c(a, b) - 0.05 * manhattan(loc[a], loc[b])
                    if best is None or score > best[0]:
                        best = (score, a, b)
        if best is None:
            break
        _, a, b = best
        parent[b] = a
        tree.add(b)
        remaining.discard(b)
    for n in obs.nodes:
        parent.setdefault(n.id, geo.parent[n.id])
    return Passive(Candidate(parent, {n: "inferred" for n in parent}), clusters, pairs)


@dataclass
class Consensus:
    parent: dict[int, int]
    agreement: dict[int, float]  # share of methods that back the chosen parent
    votes: dict[int, dict[int, list[str]]]  # node -> parent -> methods
    uncertain: list[int]


def consensus(obs: ObservableGrid, ev: Evidence, passive: Passive | None, meta: Candidate | None = None,
              plan: Candidate | None = None) -> Consensus:
    """Ensemble of physics (experiments), traditional ML (correlations), geography and the Meta
    model's own inference from the raw experiment data.

    A parent confirmed by a direct experiment always wins; otherwise the majority, with the
    physics fit breaking ties. Every node that is not experimentally confirmed and on which the
    methods do not all agree is flagged uncertain (this catches most mistakes).
    """
    physics = best_tree(obs, ev)
    methods = {"physics": physics, "geography": infer_tree(obs)}
    if passive:
        methods["correlation"] = passive.tree
    if meta:
        methods["meta_ai"] = meta
    if plan:  # the utility's drawing, counted only when the planning agent trusts it
        methods["plan"] = plan
    parent, agreement, votes, uncertain = {}, {}, {}, []
    for n in (x.id for x in obs.nodes):
        ballot: dict[int, list[str]] = {}
        for name, cand in methods.items():
            if n in cand.parent:  # an old drawing has no say on substations built after it
                ballot.setdefault(cand.parent[n], []).append(name)
        votes[n] = ballot
        if physics.basis.get(n) == "measured":
            choice = physics.parent[n]
        else:
            tally = Counter({p: len(m) for p, m in ballot.items()})
            top = max(tally.values())
            leaders = [p for p, k in tally.items() if k == top]
            choice = physics.parent[n] if physics.parent[n] in leaders else leaders[0]
        parent[n] = choice
        agreement[n] = len(ballot.get(choice, [])) / sum(1 for c in methods.values() if n in c.parent)
        if physics.basis.get(n) != "measured" and len(ballot) > 1:
            uncertain.append(n)
    return Consensus(parent, agreement, votes, uncertain)
