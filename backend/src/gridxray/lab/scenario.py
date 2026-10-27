"""Scenario generation.

A `Scenario` owns the pandapower network and therefore the true operating topology.
The agents only ever receive an `ObservableGrid`: node and device inventories, the
(possibly outdated) documented switch states and meter readings, never the lines.
"""

from dataclasses import asdict, dataclass, field
from enum import StrEnum

import numpy as np
import pandapower as pp
import pandapower.networks as pn

from gridxray.lab.measurement import SensorModel, read_meters
from gridxray.lab.profiles import sample_profile, solar

Edge = tuple[int, int]
DEFAULT_HOUR = 19  # evening peak: largest voltage drops, most informative snapshot
BLOCK_KM = 0.45  # length of one city block: MV line lengths follow street distance

Cell = tuple[int, int]  # (column, row) of a city block; substations sit in column -1

_MV_CABLE = "NA2XS2Y 1x185 RM/25 12/20 kV"  # underground XLPE cable (type "cs")
_MV_OVERHEAD = "149-AL1/24-ST1A 20.0"  # overhead ACSR conductor (type "ol")


class Complexity(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Reference(StrEnum):
    CIGRE_MV = "cigre_mv"
    MV_OBERRHEIN = "mv_oberrhein"


@dataclass(frozen=True)
class _Level:
    nodes: int
    feeders: int
    ties: int
    coverage: float
    sensors: SensorModel
    reconfigured: bool  # documented switch states are outdated


_LEVELS: dict[Complexity, _Level] = {
    # voltage noise is the random part of a reading (bias cancels in before/after deltas)
    Complexity.EASY: _Level(15, 1, 0, 1.0, SensorModel(0.0001, 0.01, 0.0), False),
    Complexity.MEDIUM: _Level(30, 2, 1, 0.8, SensorModel(0.0002, 0.02, 0.02), False),
    Complexity.HARD: _Level(60, 4, 3, 0.6, SensorModel(0.0004, 0.03, 0.05), True),
}


@dataclass(frozen=True)
class NodeInfo:
    id: int
    name: str
    metered: bool
    load_profile: str | None  # billing category; known to the utility
    mount: str = "kiosk"  # "kiosk" (ground-mounted) | "pole" (pole-mounted transformer); asset record
    location: Cell | None = None  # city block (GIS location): known, unlike the wiring


@dataclass(frozen=True)
class DeviceInfo:
    """Equipment registered at a node; its location is known, its wiring is not."""

    id: int
    kind: str  # "capacitor" (reactive compensation) | "pv" (solar plant)
    node: int
    rating: float  # kvar for capacitors, kW for PV


@dataclass(frozen=True)
class SwitchInfo:
    id: int
    kind: str  # "tie" (normally open) | "sectionalizer" | "recloser" | "fuse" (all normally closed)
    documented_closed: bool  # what the records say; may be wrong


@dataclass(frozen=True)
class ObservableGrid:
    """What the investigating agents are allowed to see."""

    substations: list[NodeInfo]
    nodes: list[NodeInfo]
    switches: list[SwitchInfo]
    devices: list[DeviceInfo]
    hour: int
    readings: dict[int, dict[str, float | None]]

    @property
    def metered_nodes(self) -> list[int]:
        return [n.id for n in self.nodes if n.metered]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Scenario:
    seed: int
    source: str  # complexity level or reference network name
    net: pp.pandapowerNet
    roots: list[int]
    names: dict[int, str]
    metered: list[int]
    sensors: SensorModel
    profiles: dict[int, np.ndarray]  # bus -> 24 h multipliers
    profile_kind: dict[int, str]
    documented_switch_closed: dict[int, bool]
    switch_kind: dict[int, str]
    rng: np.random.Generator = field(repr=False)
    mount: dict[int, str] = field(default_factory=dict)
    location: dict[int, Cell] = field(default_factory=dict)
    hour: int = DEFAULT_HOUR
    _peak: dict[int, tuple[float, float]] = field(default_factory=dict, repr=False)
    _pv_peak: dict[int, float] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self._peak = {
            int(i): (float(r.p_mw), float(r.q_mvar)) for i, r in self.net.load.iterrows()
        }
        self._pv_peak = {int(i): float(r.p_mw) for i, r in self.net.sgen.iterrows()}
        self.solve(self.hour)

    @property
    def node_ids(self) -> list[int]:
        bus = self.net.bus
        mv = bus.index[bus.vn_kv == bus.vn_kv[self.roots[0]]]
        return sorted(int(b) for b in mv if b not in self.roots)

    @property
    def true_edges(self) -> set[Edge]:
        """Energized MV connections: in-service lines whose switches are all closed."""
        open_lines = set(
            self.net.switch.element[(self.net.switch.et == "l") & ~self.net.switch.closed]
        )
        edges = set()
        for i, line in self.net.line.iterrows():
            if line.in_service and i not in open_lines:
                a, b = int(line.from_bus), int(line.to_bus)
                edges.add((min(a, b), max(a, b)))
        return edges

    def solve(self, hour: int) -> None:
        """Scale every load to its profile at `hour` and run the power flow."""
        self.hour = hour
        for i, (p, q) in self._peak.items():
            factor = self.profiles.get(int(self.net.load.bus.at[i]), np.ones(24))[hour]
            self.net.load.at[i, "p_mw"] = p * factor
            self.net.load.at[i, "q_mvar"] = q * factor
        pv = solar()[hour]
        for i, p in self._pv_peak.items():
            self.net.sgen.at[i, "p_mw"] = p * pv
        pp.runpp(self.net)

    def read_meters(self) -> dict[int, dict[str, float | None]]:
        return read_meters(self.net, self.metered, self.sensors, self.rng)

    def reveal(self) -> dict:
        """Ground truth for the end-of-run comparison and for illustrations. Never for agents."""
        adjacency: dict[int, list[int]] = {}
        for a, b in self.true_edges:
            adjacency.setdefault(a, []).append(b)
            adjacency.setdefault(b, []).append(a)
        feeder: dict[int, int] = {}
        for root in self.roots:  # feeders = subtrees hanging off each substation busbar
            for head in sorted(adjacency.get(root, [])):
                stack, feeder[head] = [head], len(set(feeder.values()))
                while stack:
                    for nxt in adjacency.get(stack.pop(), []):
                        if nxt not in feeder and nxt not in self.roots:
                            feeder[nxt] = feeder[head]
                            stack.append(nxt)
        sw = self.net.switch
        return {
            "edges": sorted(self.true_edges),
            "feeder": feeder,
            "switches": [
                {
                    "id": int(s), "kind": self.switch_kind[int(s)],
                    "closed": bool(sw.closed.at[s]),
                    "documented_closed": self.documented_switch_closed[int(s)],
                    "between": sorted((
                        int(self.net.line.from_bus.at[sw.element.at[s]]),
                        int(self.net.line.to_bus.at[sw.element.at[s]]),
                    )),
                }
                for s in sorted(self.switch_kind)
            ],
            "lines": [
                {
                    "between": sorted((int(r.from_bus), int(r.to_bus))),
                    "kind": "underground" if r.get("type") == "cs" else "overhead",
                }
                for _, r in self.net.line.iterrows()
                if int(r.from_bus) in self.names and int(r.to_bus) in self.names
            ],
            "vm_pu": {int(b): round(float(v), 5) for b, v in self.net.res_bus.vm_pu.items()},
            "faulty_meters": dict(self.sensors.faulty_meters),
        }

    def devices(self) -> list[DeviceInfo]:
        out = [
            DeviceInfo(int(i), "capacitor", int(r.bus), round(-float(r.q_mvar) * 1000, 1))
            for i, r in self.net.shunt.iterrows()
        ]
        pv: dict[int, float] = {}
        for i, r in self.net.sgen.iterrows():
            pv[int(r.bus)] = pv.get(int(r.bus), 0.0) + self._pv_peak.get(int(i), 0.0) * 1000
        out += [DeviceInfo(1000 + k, "pv", b, round(kw, 1)) for k, (b, kw) in enumerate(sorted(pv.items()))]
        return out

    def observable(self) -> ObservableGrid:
        metered = set(self.metered)
        return ObservableGrid(
            substations=[NodeInfo(r, self.names[r], False, None, "kiosk", self.location.get(r)) for r in self.roots],
            nodes=[
                NodeInfo(n, self.names[n], n in metered, self.profile_kind.get(n), self.mount.get(n, "kiosk"),
                         self.location.get(n))
                for n in self.node_ids
            ],
            switches=[
                SwitchInfo(s, self.switch_kind[s], self.documented_switch_closed[s])
                for s in sorted(self.switch_kind)
            ],
            devices=self.devices(),
            hour=self.hour,
            readings=self.read_meters(),
        )


def _assign_profiles(
    buses: list[int], rng: np.random.Generator,
) -> tuple[dict[int, np.ndarray], dict[int, str]]:
    kinds = {b: ("residential" if rng.random() < 0.7 else "commercial") for b in buses}
    return {b: sample_profile(k, rng) for b, k in kinds.items()}, kinds


def _path_to_root(parent: dict[int, int], node: int, root: int) -> list[int]:
    path = [node]
    while path[-1] != root:
        path.append(parent[path[-1]])
    return path


def generate_scenario(complexity: Complexity = Complexity.EASY, seed: int = 0) -> Scenario:
    """Random radially operated MV network behind a 110/20 kV substation.

    Each node is an MV/LV secondary substation (aggregated load). Medium and hard add
    normally open tie switches between feeders; hard also reconfigures the network
    (a tie closed, a sectionalizer opened) without updating the documented states.
    """
    lvl = _LEVELS[complexity]
    rng = np.random.default_rng(seed)

    net = pp.create_empty_network()
    hv = pp.create_bus(net, vn_kv=110.0, name="hv")
    pp.create_ext_grid(net, hv)
    root = pp.create_bus(net, vn_kv=20.0, name="mv_busbar")
    pp.create_transformer(net, hv, root, std_type="25 MVA 110/20 kV")

    parent: dict[int, int] = {}
    depth: dict[int, int] = {}
    feeder_of: dict[int, int] = {}
    line_of: dict[int, int] = {}  # child bus -> line feeding it
    nodes: list[int] = []
    # Geography first: every secondary substation occupies a city block; feeders then grow
    # block to block along the streets, so the wiring is consistent with the map.
    rows = max(3, round(np.sqrt(lvl.nodes * 0.9)))
    mid = (rows - 1) // 2
    location: dict[int, Cell] = {int(root): (-1, mid)}
    taken: set[Cell] = set()
    steps = [((1, 0), 3.0), ((0, 1), 1.0), ((0, -1), 1.0), ((1, 1), 1.2), ((1, -1), 1.2)]

    def grow() -> tuple[int, Cell]:
        weights = np.linspace(1.0, 3.0, len(nodes))
        for _ in range(60):
            src = int(rng.choice(nodes, p=weights / weights.sum()))
            c, r = location[src]
            free = [((c + dc, r + dr), w) for (dc, dr), w in steps
                    if 0 <= r + dr < rows and (c + dc, r + dr) not in taken]
            if free:
                ws = np.array([w for _, w in free])
                return src, free[int(rng.choice(len(free), p=ws / ws.sum()))][0]
        for src in nodes:  # crowded: take any free neighbouring block
            c, r = location[src]
            for (dc, dr), _ in steps:
                if 0 <= r + dr < rows and (c + dc, r + dr) not in taken:
                    return src, (c + dc, r + dr)
        raise RuntimeError("no free block")

    for i in range(lvl.nodes):
        bus = pp.create_bus(net, vn_kv=20.0)
        if i < lvl.feeders:
            cell = (0, round((i + 0.5) * rows / lvl.feeders - 0.5))
            parent[bus], feeder_of[bus], depth[bus] = root, i, 1
            blocks = 1 + abs(cell[1] - mid) * 0.5
        else:
            src, cell = grow()
            parent[bus], feeder_of[bus], depth[bus] = src, feeder_of[src], depth[src] + 1
            blocks = abs(cell[0] - location[src][0]) + abs(cell[1] - location[src][1])
        location[bus] = cell
        taken.add(cell)
        # urban trunk near the substation tends to be underground; outer sections overhead
        underground = rng.random() < (0.75 if depth[bus] <= 2 else 0.3)
        line_of[bus] = pp.create_line(
            net, parent[bus], bus, length_km=float(blocks * BLOCK_KM * rng.uniform(0.9, 1.25)),
            std_type=_MV_CABLE if underground else _MV_OVERHEAD,
        )
        p_mw = float(rng.uniform(0.1, 0.4))
        pp.create_load(net, bus, p_mw=p_mw, q_mvar=p_mw * 0.33)
        nodes.append(bus)

    switch_kind: dict[int, str] = {}
    documented: dict[int, bool] = {}

    def add_switch(line: int, bus: int, kind: str, closed: bool) -> int:
        s = int(pp.create_switch(net, bus, line, et="l", closed=closed, type="LBS"))
        switch_kind[s], documented[s] = kind, closed
        return s

    sectional_by_line: dict[int, int] = {}
    for bus in nodes:
        if rng.random() < 0.3:
            line = line_of[bus]
            sectional_by_line[line] = add_switch(line, parent[bus], "sectionalizer", True)

    ties: list[tuple[int, int, int]] = []  # (switch, x, y)
    def blocks_apart(a: int, b: int) -> int:
        return abs(location[a][0] - location[b][0]) + abs(location[a][1] - location[b][1])

    # ties link feeders where they run close to each other
    near = [(a, b) for i, a in enumerate(nodes) for b in nodes[i + 1:]
            if feeder_of[a] != feeder_of[b] and blocks_apart(a, b) <= 2]
    for _ in range(lvl.ties):
        if near:
            x, y = near.pop(int(rng.integers(len(near))))
        else:
            x, y = (int(b) for b in rng.choice(nodes, size=2, replace=False))
            while feeder_of[x] == feeder_of[y]:
                x, y = (int(b) for b in rng.choice(nodes, size=2, replace=False))
        line = pp.create_line(net, x, y, length_km=float(max(1, blocks_apart(x, y)) * BLOCK_KM * rng.uniform(0.9, 1.25)),
                              std_type=_MV_CABLE if rng.random() < 0.5 else _MV_OVERHEAD)
        ties.append((add_switch(line, x, "tie", False), x, y))

    if lvl.reconfigured and ties:
        # Close one tie and open a line on the other side's path to the substation,
        # so the network stays radial but no longer matches the records.
        tie, _, y = ties[int(rng.integers(len(ties)))]
        net.switch.at[tie, "closed"] = True
        path = _path_to_root(parent, y, root)[:-1]  # buses whose feeding line can be opened
        cut_bus = path[int(rng.integers(len(path)))]
        cut_line = line_of[cut_bus]
        cut = sectional_by_line.get(cut_line) or add_switch(
            cut_line, parent[cut_bus], "sectionalizer", True,
        )
        net.switch.at[cut, "closed"] = False

    overhead = {int(i) for i in net.line.index[net.line.type == "ol"]}

    # reclosers: one on each long feeder, on an overhead trunk section halfway out
    for f in range(lvl.feeders):
        members = [b for b in nodes if feeder_of[b] == f]
        if len(members) < 6:
            continue
        mid = max(depth[b] for b in members) // 2
        candidates = [b for b in members if depth[b] == max(mid, 2) and line_of[b] in overhead]
        if candidates:
            b = int(rng.choice(candidates))
            if line_of[b] not in sectional_by_line:
                add_switch(line_of[b], parent[b], "recloser", True)

    # fuse cutouts protect overhead laterals where a branch leaves the trunk
    kids: dict[int, list[int]] = {}
    for b in nodes:
        kids.setdefault(parent[b], []).append(b)
    used = set(net.switch.element[net.switch.et == "l"])
    for p_bus, children in kids.items():
        for b in children[1:]:  # first child continues the trunk
            if line_of[b] in overhead and line_of[b] not in used and rng.random() < 0.7:
                add_switch(line_of[b], p_bus, "fuse", True)

    # pole-mounted transformers sit on overhead lines; kiosks on underground cables
    mount = {b: ("pole" if line_of[b] in overhead and rng.random() < 0.6 else "kiosk") for b in nodes}

    # reactive compensation and solar plants on the outer parts of the network
    deep = sorted(nodes, key=lambda b: -depth[b])
    for b in deep[: {Complexity.EASY: 0, Complexity.MEDIUM: 1, Complexity.HARD: 2}[complexity]]:
        pp.create_shunt(net, b, q_mvar=-float(rng.choice([0.3, 0.45, 0.6])), p_mw=0.0)
    for b in rng.choice(nodes, size={Complexity.EASY: 0, Complexity.MEDIUM: 1, Complexity.HARD: 2}[complexity], replace=False):
        pp.create_sgen(net, int(b), p_mw=float(rng.uniform(0.6, 1.5)), type="PV")

    names = {root: "Substation", **{b: f"SS-{i + 1:02d}" for i, b in enumerate(nodes)}}
    profiles, kinds = _assign_profiles(nodes, rng)
    n_metered = max(1, round(lvl.coverage * len(nodes)))
    metered = sorted(int(b) for b in rng.choice(nodes, size=n_metered, replace=False))

    sensors = lvl.sensors
    if complexity == Complexity.HARD:
        faulty = int(rng.choice(metered))
        sensors = SensorModel(
            sensors.voltage_noise_pu, sensors.power_noise_rel, sensors.missing_rate,
            {faulty: str(rng.choice(["stuck", "biased"]))},
        )

    return Scenario(
        seed=seed, source=complexity.value, net=net, roots=[int(root)], names=names,
        metered=metered, sensors=sensors, profiles=profiles, profile_kind=kinds,
        documented_switch_closed=documented, switch_kind=switch_kind, rng=rng, mount=mount,
        location=location,
    )


def _grid_locations(net: pp.pandapowerNet, roots: list[int], nodes: list[int]) -> dict[int, Cell]:
    """Snap the network's own geodata onto the city grid, one block per substation."""
    import json

    coords: dict[int, tuple[float, float]] = {}
    for b in nodes + roots:
        geo = net.bus.geo.at[b] if "geo" in net.bus.columns else None
        if isinstance(geo, str):
            x, y = json.loads(geo)["coordinates"][:2]
            coords[b] = (float(x), float(y))
    if len(coords) < len(nodes) + len(roots):
        return {}
    xs = [coords[b][0] for b in nodes]
    ys = [coords[b][1] for b in nodes]
    cols = max(3, round(np.sqrt(len(nodes) * 1.6)))
    rows = max(3, round(len(nodes) / cols * 1.4))
    span_x = (max(xs) - min(xs)) or 1.0
    span_y = (max(ys) - min(ys)) or 1.0
    taken: set[Cell] = set()
    out: dict[int, Cell] = {}
    for b in sorted(nodes, key=lambda b: coords[b]):
        c0 = round((coords[b][0] - min(xs)) / span_x * (cols - 1))
        r0 = round((max(ys) - coords[b][1]) / span_y * (rows - 1))
        for radius in range(cols + rows):  # nearest free block, spiralling out
            ring = [(c0 + dc, r0 + dr) for dc in range(-radius, radius + 1) for dr in range(-radius, radius + 1)
                    if max(abs(dc), abs(dr)) == radius and c0 + dc >= 0 and r0 + dr >= 0]
            free = [cell for cell in ring if cell not in taken]
            if free:
                out[b] = free[0]
                taken.add(free[0])
                break
    used_rows: set[int] = set()
    for r in roots:  # substations sit west of the city, on their own row
        row = round((max(ys) - coords[r][1]) / span_y * (rows - 1))
        while row in used_rows:
            row += 3
        used_rows.update({row - 1, row, row + 1})
        out[r] = (-1, max(0, row))
    return out


def load_reference(name: Reference, seed: int = 0, coverage: float = 0.8) -> Scenario:
    """A published benchmark network from pandapower with its topology hidden."""
    net = pn.create_cigre_network_mv(with_der=False) if name == Reference.CIGRE_MV \
        else pn.mv_oberrhein()
    rng = np.random.default_rng(seed)
    roots = sorted(int(b) for b in net.trafo.lv_bus.unique())
    mv = net.bus.index[net.bus.vn_kv == net.bus.vn_kv[roots[0]]]
    nodes = sorted(int(b) for b in mv if b not in roots)

    line_switches = net.switch[net.switch.et == "l"]
    switch_kind = {
        int(s): ("sectionalizer" if r.closed else "tie") for s, r in line_switches.iterrows()
    }
    documented = {int(s): bool(r.closed) for s, r in line_switches.iterrows()}

    mount: dict[int, str] = {}
    for b in nodes:
        lines = net.line[(net.line.from_bus == b) | (net.line.to_bus == b)]
        mount[b] = "pole" if (lines.type == "ol").any() and rng.random() < 0.6 else "kiosk"

    names = {r: f"Substation {chr(65 + i)}" for i, r in enumerate(roots)}
    names |= {b: f"SS-{i + 1:03d}" for i, b in enumerate(nodes)}
    loaded = sorted(int(b) for b in net.load.bus.unique() if int(b) in nodes)
    profiles, kinds = _assign_profiles(loaded, rng)
    n_metered = max(1, round(coverage * len(nodes)))
    metered = sorted(int(b) for b in rng.choice(nodes, size=n_metered, replace=False))

    return Scenario(
        seed=seed, source=name.value, net=net, roots=roots, names=names, metered=metered,
        sensors=_LEVELS[Complexity.MEDIUM].sensors, profiles=profiles, profile_kind=kinds,
        documented_switch_closed=documented, switch_kind=switch_kind, rng=rng, mount=mount,
        location=_grid_locations(net, roots, nodes),
    )
