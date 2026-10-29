"""Networks designed by the user: secondary substations on city blocks, joined by cables.

A design is plain JSON (the editor in the web app produces it). `validate_design` explains
what is wrong in words; `build_custom` turns a valid design into a `Scenario` whose wiring
stays hidden from the agents exactly like a generated one.
"""

import numpy as np
import pandapower as pp
from pydantic import BaseModel, Field

from gridxray.lab.measurement import SensorModel
from gridxray.lab.profiles import sample_profile
from gridxray.lab.scenario import _MV_CABLE, _MV_OVERHEAD, BLOCK_KM, Scenario

SUBSTATION = "S"  # key of the HV/MV substation in a design
MAX_NODES = 60
NOISE = {  # meter quality, same scale as the generated levels
    "clean": SensorModel(0.0001, 0.01, 0.0),
    "realistic": SensorModel(0.0002, 0.02, 0.02),
    "noisy": SensorModel(0.0004, 0.03, 0.05),
}
SWITCH_KINDS = ("tie", "sectionalizer", "recloser", "fuse")


class DesignNode(BaseModel):
    key: str = Field(min_length=1, max_length=24)
    name: str = Field(min_length=1, max_length=24)
    cell: tuple[int, int]  # (column, row) city block
    mount: str = Field(default="kiosk", pattern="^(kiosk|pole)$")
    profile: str = Field(default="residential", pattern="^(residential|commercial)$")
    kw: float = Field(default=250.0, gt=0, le=3000)
    metered: bool = True


class DesignSwitch(BaseModel):
    kind: str = Field(default="sectionalizer", pattern="^(tie|sectionalizer|recloser|fuse)$")
    closed: bool = True  # its real position
    documented_closed: bool | None = None  # what the records say; None = same as the real position


class DesignLine(BaseModel):
    a: str  # node key or "S" (substation)
    b: str
    kind: str = Field(default="overhead", pattern="^(overhead|underground)$")
    switch: DesignSwitch | None = None


class Design(BaseModel):
    name: str = Field(default="My network", min_length=1, max_length=60)
    substation_row: int = Field(default=2, ge=0, le=30)
    nodes: list[DesignNode] = Field(default_factory=list)
    lines: list[DesignLine] = Field(default_factory=list)
    noise: str = Field(default="realistic", pattern="^(clean|realistic|noisy)$")


def energized(line: DesignLine) -> bool:
    return line.switch is None or line.switch.closed


def validate_design(d: Design) -> list[str]:
    """Everything that would stop the network from working, in plain words (empty = valid)."""
    errors: list[str] = []
    keys = [n.key for n in d.nodes]
    if not d.nodes:
        return ["Add at least one secondary substation."]
    if len(d.nodes) > MAX_NODES:
        errors.append(f"At most {MAX_NODES} secondary substations.")
    if len(set(keys)) != len(keys) or SUBSTATION in keys:
        errors.append("Two secondary substations share the same key.")
    names = [n.name for n in d.nodes]
    for dup in sorted({x for x in names if names.count(x) > 1}):
        errors.append(f"Two secondary substations are both named {dup}.")
    cells = [tuple(n.cell) for n in d.nodes]
    if len(set(cells)) != len(cells):
        errors.append("Two secondary substations are on the same block.")
    if any(c[0] < 0 or c[1] < 0 for c in cells):
        errors.append("Secondary substations must sit inside the city grid.")
    known = set(keys) | {SUBSTATION}
    name_of = {n.key: n.name for n in d.nodes} | {SUBSTATION: "the substation"}
    pairs = set()
    for ln in d.lines:
        if ln.a not in known or ln.b not in known:
            errors.append("A cable ends at a substation that no longer exists.")
            continue
        if ln.a == ln.b:
            errors.append(f"A cable starts and ends at {name_of[ln.a]}.")
        pair = frozenset((ln.a, ln.b))
        if pair in pairs:
            errors.append(f"Two cables join {name_of[ln.a]} and {name_of[ln.b]}.")
        pairs.add(pair)
    if errors:
        return errors

    # energized network: must reach every secondary substation exactly once (radial operation)
    adj: dict[str, list[str]] = {k: [] for k in known}
    for ln in d.lines:
        if energized(ln):
            adj[ln.a].append(ln.b)
            adj[ln.b].append(ln.a)
    if not adj[SUBSTATION]:
        return ["Connect at least one cable to the substation."]
    seen, stack, loop = {SUBSTATION}, [(SUBSTATION, None)], False
    while stack:
        cur, parent = stack.pop()
        for nxt in adj[cur]:
            if nxt == parent:
                continue
            if nxt in seen:
                loop = True
                continue
            seen.add(nxt)
            stack.append((nxt, cur))
    dead = [name_of[k] for k in keys if k not in seen]
    if dead:
        errors.append(f"No supply reaches {', '.join(sorted(dead)[:6])}{'…' if len(dead) > 6 else ''}: "
                      "connect them with a cable whose switch is closed.")
    if loop:
        errors.append("The closed cables form a loop. Distribution networks are operated radially: "
                      "open one switch in the loop (make it a normally open tie).")
    return errors


def _blocks(a: tuple[int, int], b: tuple[int, int]) -> int:
    return max(1, abs(a[0] - b[0]) + abs(a[1] - b[1]))


def build_custom(d: Design, seed: int = 0, source: str = "custom") -> Scenario:
    """A pandapower network from a valid design; the wiring is the hidden truth."""
    problems = validate_design(d)
    if problems:
        raise ValueError(problems[0])
    rng = np.random.default_rng(seed)
    net = pp.create_empty_network()
    hv = pp.create_bus(net, vn_kv=110.0, name="hv")
    pp.create_ext_grid(net, hv)
    root = int(pp.create_bus(net, vn_kv=20.0, name="mv_busbar"))
    pp.create_transformer(net, hv, root, std_type="25 MVA 110/20 kV")

    bus: dict[str, int] = {SUBSTATION: root}
    cell: dict[str, tuple[int, int]] = {SUBSTATION: (-1, d.substation_row)}
    for n in d.nodes:
        bus[n.key] = int(pp.create_bus(net, vn_kv=20.0, name=n.name))
        cell[n.key] = (int(n.cell[0]), int(n.cell[1]))
        pp.create_load(net, bus[n.key], p_mw=n.kw / 1000, q_mvar=n.kw * 0.33 / 1000)

    switch_kind: dict[int, str] = {}
    documented: dict[int, bool] = {}
    for ln in d.lines:
        a, b = (ln.b, ln.a) if ln.b == SUBSTATION else (ln.a, ln.b)  # lines leave the substation
        line = pp.create_line(net, bus[a], bus[b], length_km=float(_blocks(cell[a], cell[b]) * BLOCK_KM),
                              std_type=_MV_CABLE if ln.kind == "underground" else _MV_OVERHEAD)
        if ln.switch:
            s = int(pp.create_switch(net, bus[a], line, et="l", closed=ln.switch.closed, type="LBS"))
            switch_kind[s] = ln.switch.kind
            documented[s] = ln.switch.closed if ln.switch.documented_closed is None else ln.switch.documented_closed

    nodes = [bus[n.key] for n in d.nodes]
    profiles = {bus[n.key]: sample_profile(n.profile, rng) for n in d.nodes}
    return Scenario(
        seed=seed, source=source, net=net, roots=[root],
        names={root: "Substation", **{bus[n.key]: n.name for n in d.nodes}},
        metered=sorted(bus[n.key] for n in d.nodes if n.metered) or nodes[:1],
        sensors=NOISE[d.noise], profiles=profiles, profile_kind={bus[n.key]: n.profile for n in d.nodes},
        documented_switch_closed=documented, switch_kind=switch_kind, rng=rng,
        mount={bus[n.key]: n.mount for n in d.nodes}, location={bus[k]: c for k, c in cell.items()},
    )


def design_from_scenario(s: Scenario, name: str) -> Design:
    """Start the editor from a generated network (its real wiring), so it can be modified."""
    key = {b: f"n{b}" for b in s.node_ids}
    key[s.roots[0]] = SUBSTATION
    loads = s.net.load.groupby("bus").p_mw.sum()
    nodes = [DesignNode(key=key[b], name=s.names[b], cell=s.location[b], mount=s.mount.get(b, "kiosk"),
                        profile=s.profile_kind.get(b, "residential"), kw=round(float(loads.get(b, 0.25)) * 1000, 0) or 250.0,
                        metered=b in s.metered)
             for b in s.node_ids]
    sw_of = {int(s.net.switch.element.at[i]): int(i) for i in s.switch_kind}
    lines = []
    for i, r in s.net.line.iterrows():
        a, b = int(r.from_bus), int(r.to_bus)
        if a not in key or b not in key:
            continue
        sid = sw_of.get(int(i))
        switch = None if sid is None else DesignSwitch(
            kind=s.switch_kind[sid], closed=bool(s.net.switch.closed.at[sid]),
            documented_closed=s.documented_switch_closed[sid])
        lines.append(DesignLine(a=key[a], b=key[b], kind="underground" if r.get("type") == "cs" else "overhead", switch=switch))
    noise = "clean" if s.sensors.missing_rate == 0 else ("noisy" if s.sensors.missing_rate >= 0.05 else "realistic")
    return Design(name=name, substation_row=s.location[s.roots[0]][1], nodes=nodes, lines=lines, noise=noise)
