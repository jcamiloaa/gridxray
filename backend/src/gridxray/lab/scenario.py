"""Scenario generation.

A `Scenario` owns the pandapower network and the true topology. The agent only ever
receives an `ObservableGrid`, which carries no edge information.
"""

from dataclasses import dataclass, field
from enum import StrEnum

import numpy as np
import pandapower as pp

Edge = tuple[int, int]


class Complexity(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


# nodes, feeders, meter coverage, voltage noise std (pu)
_LEVELS: dict[Complexity, tuple[int, int, float, float]] = {
    Complexity.EASY: (15, 1, 1.0, 0.0005),
    Complexity.MEDIUM: (30, 2, 0.8, 0.001),
    Complexity.HARD: (60, 4, 0.6, 0.002),
}


@dataclass(frozen=True)
class ObservableGrid:
    """What the investigating agent is allowed to see."""

    nodes: list[int]
    metered_nodes: list[int]
    root: int


@dataclass
class Scenario:
    seed: int
    complexity: Complexity
    net: pp.pandapowerNet
    true_edges: set[Edge]
    metered_nodes: list[int]
    noise_std: float
    root: int
    rng: np.random.Generator = field(repr=False)

    def observable(self) -> ObservableGrid:
        bus = self.net.bus
        mv = bus.index[bus.vn_kv == bus.vn_kv[self.root]]
        nodes = sorted(int(b) for b in mv if b != self.root)
        return ObservableGrid(nodes=nodes, metered_nodes=list(self.metered_nodes), root=self.root)


def generate_scenario(complexity: Complexity = Complexity.EASY, seed: int = 0) -> Scenario:
    """Build random radial MV feeders behind a 110/20 kV substation and solve the power flow.

    Each node is an MV/LV secondary substation modelled as an aggregated load.
    Minimal D1 version; tie switches, load profiles and sensor faults land on D2.
    """
    n_nodes, n_feeders, coverage, noise_std = _LEVELS[complexity]
    rng = np.random.default_rng(seed)

    net = pp.create_empty_network()
    hv = pp.create_bus(net, vn_kv=110.0, name="hv")
    pp.create_ext_grid(net, hv)
    root = pp.create_bus(net, vn_kv=20.0, name="mv_busbar")
    pp.create_transformer(net, hv, root, std_type="25 MVA 110/20 kV")

    buses = [root]
    true_edges: set[Edge] = set()
    for i in range(n_nodes):
        bus = pp.create_bus(net, vn_kv=20.0, name=f"n{i}")
        if i < n_feeders:
            parent = root  # feeder head
        else:
            # Prefer recent buses so feeders grow long rather than star-shaped.
            feeder_buses = buses[1:]
            weights = np.linspace(1.0, 3.0, len(feeder_buses))
            parent = int(rng.choice(feeder_buses, p=weights / weights.sum()))
        pp.create_line(
            net, parent, bus, length_km=float(rng.uniform(0.2, 1.5)),
            std_type="NA2XS2Y 1x185 RM/25 12/20 kV",
        )
        p_mw = float(rng.uniform(0.1, 0.4))
        pp.create_load(net, bus, p_mw=p_mw, q_mvar=p_mw * 0.33)
        true_edges.add((min(parent, bus), max(parent, bus)))
        buses.append(bus)

    pp.runpp(net)

    candidates = [b for b in buses if b != root]
    n_metered = max(1, round(coverage * len(candidates)))
    metered = sorted(int(b) for b in rng.choice(candidates, size=n_metered, replace=False))

    return Scenario(
        seed=seed, complexity=complexity, net=net, true_edges=true_edges,
        metered_nodes=metered, noise_std=noise_std, root=int(root), rng=rng,
    )
