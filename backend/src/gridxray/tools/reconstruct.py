"""Turning experiment results into topology evidence and a candidate tree.

Physics: adding ΔP at node i lowers the voltage at node j by about z·ΔP, where z is the
impedance of the path that i and j share from the substation (LinDistFlow). So, per MW,
  S[i][j] ≈ R(LCA(i, j)),  and  S[i][i] = R(i)  (i's own electrical depth).
Node k is an ancestor of j exactly when S[k][j] ≈ R(k).
"""

from collections import defaultdict
from dataclasses import dataclass, field

from gridxray.lab import ObservableGrid
from gridxray.sim import ExperimentRecord

DEFAULT_TOL = 1.2e-4  # pu per MW: about a third of one block of line
MAX_HOP = 2  # feeder sections join blocks at most two streets apart


def manhattan(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


@dataclass
class Evidence:
    """Sensitivities S[i][j] (pu per MW, positive = voltage drop) from load perturbations."""

    sens: dict[int, dict[int, float]] = field(default_factory=dict)
    depth: dict[int, float] = field(default_factory=dict)  # R(i) for perturbed nodes
    tol: float = DEFAULT_TOL

    @classmethod
    def from_records(cls, records: list[ExperimentRecord], tol: float = DEFAULT_TOL) -> "Evidence":
        acc: dict[int, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
        for r in records:
            if not r.accepted or r.action.get("type") != "perturb_load":
                continue
            mw = r.delta_p_kw / 1000
            for j, dv in r.delta_vm.items():
                if dv is not None:
                    acc[r.action["node"]][j].append(-dv / mw)
        sens = {i: {j: sum(v) / len(v) for j, v in row.items()} for i, row in acc.items()}
        depth = {i: row.get(i, max(row.values(), default=0.0)) for i, row in sens.items()}
        return cls(sens, depth, tol)

    def is_ancestor(self, k: int, j: int) -> bool | None:
        """True/False when the data can tell whether k feeds j; None when it cannot."""
        if k == j:
            return False
        if k in self.sens and j in self.sens[k]:
            return abs(self.sens[k][j] - self.depth[k]) <= self.tol and self.depth[k] < self._self_depth(j)
        if j in self.sens and k in self.sens[j] and k in self.depth:
            return abs(self.sens[j][k] - self.depth[k]) <= self.tol
        return None

    def _self_depth(self, j: int) -> float:
        return self.depth.get(j, float("inf"))

    def depth_estimate(self, c: int) -> float | None:
        """Electrical depth of any metered node: its largest drop in any experiment.

        Exact when c lies on the path of some perturbed node (that drop is R(c)); otherwise a
        lower bound. Perturbed nodes use their own drop.
        """
        if c in self.depth:
            return self.depth[c]
        seen = [row[c] for row in self.sens.values() if c in row]
        return max(seen) if seen else None

    def downstream(self, k: int) -> list[int]:
        """Metered nodes the data places below k (k's subtree)."""
        if k not in self.sens:
            return []
        return sorted(j for j in self.sens[k] if j != k and self.is_ancestor(k, j))


@dataclass
class Candidate:
    parent: dict[int, int]  # child -> parent (a node or a substation)
    basis: dict[int, str]  # child -> "measured" | "inferred"

    def edges(self) -> set[tuple[int, int]]:
        return {(min(c, p), max(c, p)) for c, p in self.parent.items()}


def infer_tree(obs: ObservableGrid, ev: Evidence | None = None) -> Candidate:
    """Best tree consistent with the evidence; gaps are filled from geography and voltage."""
    ev = ev or Evidence()
    loc = {n.id: n.location for n in obs.nodes}
    roots = {s.id: s.location for s in obs.substations}
    vm = {n: r["vm_pu"] for n, r in obs.readings.items() if r["vm_pu"] is not None}
    nodes = [n.id for n in obs.nodes]

    def root_for(j: int) -> int:
        return min(roots, key=lambda r: abs(roots[r][1] - loc[j][1]))

    def upstream_score(c: int, j: int) -> float | None:
        """How plausible c is as j's parent; None if c looks downstream of j."""
        if ev.is_ancestor(j, c):
            return None
        if c in vm and j in vm:
            if vm[c] < vm[j] - 0.0005:
                return None
            electrical = (vm[c] - vm[j]) * 400
        else:
            if loc[c][0] > loc[j][0]:
                return None
            electrical = (loc[j][0] - loc[c][0]) * 0.4
        return electrical - manhattan(loc[c], loc[j]) * 0.7

    def best_neighbour(j: int, within: set[int] | None = None) -> int | None:
        scored = []
        for c in nodes:
            if c == j or manhattan(loc[c], loc[j]) > MAX_HOP or (within is not None and c not in within):
                continue
            s = upstream_score(c, j)
            if s is not None:
                scored.append((s, c))
        return max(scored)[1] if scored else None

    parent: dict[int, int] = {}
    basis: dict[int, str] = {}
    depth = {c: ev.depth_estimate(c) for c in nodes}
    for j in nodes:
        known = [k for k in ev.depth if ev.is_ancestor(k, j)]
        if known:
            # j hangs below every node in `known`; its parent is the deepest neighbour that is
            # consistent with that, which may be an unperturbed node between them
            deepest = max(known, key=lambda k: ev.depth[k])
            dj = depth[j]
            below_j = [m for m in ev.depth if ev.is_ancestor(j, m)]  # perturbed nodes under j
            cands = []
            for c in nodes:
                if c == j or manhattan(loc[c], loc[j]) > MAX_HOP or ev.is_ancestor(j, c):
                    continue
                if c != deepest and ev.is_ancestor(deepest, c) is False:
                    continue  # c is not below the deepest known ancestor
                if c != deepest and ev.is_ancestor(c, j) is False:
                    continue  # c is on another branch (e.g. a sibling of j)
                if any(c in ev.sens[m] and depth[c] is not None and ev.sens[m][c] < depth[c] - ev.tol for m in below_j):
                    continue  # an ancestor of j must lie on the path of every node below j
                dc = depth[c]
                if dc is None or dc < ev.depth[deepest] - ev.tol:
                    continue
                if dj is not None and dc >= dj - ev.tol / 2:
                    continue  # c is not shallower than j
                cands.append((dc, -manhattan(loc[c], loc[j]), c))
            if cands:
                _, _, p = max(cands)
                exact = p in ev.depth or any(p in ev.sens[m] and abs(ev.sens[m][p] - depth[p]) <= ev.tol
                                             and ev.depth[m] > depth[p] + ev.tol for m in ev.depth)
                parent[j], basis[j] = p, ("measured" if exact else "inferred")
                continue
            below_a = {c for c in nodes if c == deepest or ev.is_ancestor(deepest, c) is not False}
            p = best_neighbour(j, below_a)
            parent[j], basis[j] = (p if p is not None else deepest), "inferred"
            continue
        no_feeder_above = ev.depth and all(ev.is_ancestor(k, j) is False for k in ev.depth)
        if loc[j][0] == 0 and (no_feeder_above or best_neighbour(j) is None):
            parent[j], basis[j] = root_for(j), ("measured" if no_feeder_above else "inferred")
            continue
        p = best_neighbour(j)
        parent[j], basis[j] = (p if p is not None else root_for(j)), "inferred"

    # break any cycle by attaching its most upstream member to the nearest substation
    for start in nodes:
        seen: list[int] = []
        cur = start
        while cur in parent and cur not in seen:
            seen.append(cur)
            cur = parent[cur]
        if cur in parent:  # cycle found
            cycle = seen[seen.index(cur):]
            top = max(cycle, key=lambda n: (vm.get(n, 0.0), -loc[n][0]))
            parent[top], basis[top] = root_for(top), "inferred"
    return Candidate(parent, basis)


def check_tree(obs: ObservableGrid, parent: dict[int, int]) -> str | None:
    """Why a proposed tree is invalid, or None if every node reaches a substation once."""
    ids = {n.id for n in obs.nodes}
    roots = {s.id for s in obs.substations}
    missing = ids - parent.keys()
    if missing:
        return f"{len(missing)} nodes have no parent"
    for j in ids:
        seen = set()
        cur = j
        while cur not in roots:
            if cur in seen:
                return "the proposal contains a loop"
            seen.add(cur)
            if cur not in parent or (parent[cur] not in ids and parent[cur] not in roots):
                return f"node {cur} points to an unknown parent"
            cur = parent[cur]
    return None


Z_PER_KM_MW = 6.25e-4  # pu drop per km of shared path per MW (pf 0.95, mixed cable/overhead)
BLOCK_KM = 0.45


def predicted_sensitivity(obs: ObservableGrid, parent: dict[int, int]) -> dict[int, dict[int, float]]:
    """S[i][j] a hypothesis predicts (up to a common transformer offset), from street distances."""
    loc = {n.id: n.location for n in obs.nodes} | {s.id: s.location for s in obs.substations}
    roots = {s.id for s in obs.substations}
    ids = [n.id for n in obs.nodes]
    depth: dict[int, float] = {}
    chain: dict[int, list[int]] = {}

    def resolve(j: int) -> float:
        if j in roots:
            return 0.0
        if j not in depth:
            p = parent[j]
            hop = max(1, manhattan(loc[j], loc[p])) * BLOCK_KM * Z_PER_KM_MW
            depth[j] = resolve(p) + hop
            chain[j] = ([] if p in roots else chain[p]) + [j]
        return depth[j]

    for j in ids:
        resolve(j)
    pred: dict[int, dict[int, float]] = {}
    for i in ids:
        anc_i = set(chain[i])
        pred[i] = {}
        for j in ids:
            lca = max((a for a in chain[j] if a in anc_i), key=lambda a: depth[a], default=None)
            pred[i][j] = depth[lca] if lca is not None else 0.0
    return pred


def _residual(obs: ObservableGrid, ev: Evidence, parent: dict[int, int]) -> float:
    """How badly a tree explains the measured drops (sum of squares, common transformer offset removed)."""
    if check_tree(obs, parent):
        return float("inf")
    pred = predicted_sensitivity(obs, parent)
    total = 0.0
    for i, row in ev.sens.items():
        diffs = [row[j] - pred[i][j] for j in row if j in pred[i]]
        if diffs:
            off = sum(diffs) / len(diffs)
            total += sum((d - off) ** 2 for d in diffs)
    return total


def refine(obs: ObservableGrid, ev: Evidence, cand: Candidate, rounds: int = 3, max_nodes: int = 45) -> Candidate:
    """Hill-climb: reattach nodes to nearby parents while that explains the measured drops better.

    Uses the numeric value of every drop, not only equality tests. Skipped on very large
    networks to keep tool calls fast.
    """
    if not ev.sens or len(obs.nodes) > max_nodes:
        return cand
    loc = {n.id: n.location for n in obs.nodes}
    roots = [s.id for s in obs.substations]
    parent, basis = dict(cand.parent), dict(cand.basis)
    best = _residual(obs, ev, parent)
    for _ in range(rounds):
        improved = False
        for j, lj in loc.items():
            if cand.basis.get(j) == "measured":
                continue  # directly confirmed by an ancestor test: never second-guessed by the model fit
            options = [c for c, lc in loc.items() if c != j and manhattan(lc, lj) <= MAX_HOP]
            if lj[0] == 0:
                options += roots
            for c in options:
                if c == parent[j]:
                    continue
                trial = dict(parent)
                trial[j] = c
                r = _residual(obs, ev, trial)
                if r < best - 1e-12:
                    best, parent, improved = r, trial, True
                    basis[j] = "inferred"  # chosen by model fit, not by a direct ancestor test
        if not improved:
            break
    return Candidate(parent, basis)


def best_tree(obs: ObservableGrid, ev: Evidence | None = None) -> Candidate:
    """Ancestor-test reconstruction, then a physics fit to the measured drops."""
    ev = ev or Evidence()
    return refine(obs, ev, infer_tree(obs, ev))
