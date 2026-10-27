import dataclasses
import json

import pytest

from gridxray.lab import Complexity, Reference, generate_scenario, load_reference


def _is_radial(s) -> bool:
    """Energized edges form a forest where every node reaches exactly one substation."""
    parent = {n: n for n in s.node_ids + s.roots}

    def find(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    for a, b in s.true_edges:
        ra, rb = find(a), find(b)
        if ra == rb:
            return False  # loop
        parent[ra] = rb
    components = {find(n) for n in s.node_ids + s.roots}
    return len(components) == len(s.roots) and len({find(r) for r in s.roots}) == len(s.roots)


@pytest.mark.parametrize("level", list(Complexity))
def test_synthetic_scenario_is_radial_and_solved(level):
    s = generate_scenario(level, seed=1)
    assert _is_radial(s)
    assert s.net.converged
    assert s.net.res_bus.vm_pu.between(0.9, 1.1).all()


@pytest.mark.parametrize("ref", list(Reference))
def test_reference_networks_load(ref):
    s = load_reference(ref)
    assert s.net.converged and _is_radial(s)
    assert len(s.roots) == 2  # both references have two HV/MV transformers


def test_same_seed_same_scenario():
    a, b = generate_scenario(Complexity.HARD, seed=7), generate_scenario(Complexity.HARD, seed=7)
    assert a.true_edges == b.true_edges
    assert a.observable().readings == b.observable().readings


def test_observable_view_hides_topology():
    obs = generate_scenario(Complexity.HARD, seed=3).observable()
    assert {f.name for f in dataclasses.fields(obs)} == {
        "substations", "nodes", "switches", "devices", "hour", "readings",
    }
    assert {f.name for f in dataclasses.fields(obs.switches[0])} == {
        "id", "kind", "documented_closed",
    }  # no endpoints, no actual state
    payload = json.dumps(obs.to_dict())
    for leak in ("edges", "from_bus", "to_bus", "between", "feeder", "faulty", "overhead", "underground"):
        assert leak not in payload


def test_hard_records_are_outdated():
    s = generate_scenario(Complexity.HARD, seed=5)
    actual = dict(zip(s.net.switch.index, s.net.switch.closed, strict=True))
    mismatched = [k for k, v in s.documented_switch_closed.items() if actual[k] != v]
    assert len(mismatched) == 2  # one tie closed + one sectionalizer opened
    assert len(s.sensors.faulty_meters) == 1


def test_easy_has_clean_meters_and_no_ties():
    s = generate_scenario(Complexity.EASY, seed=2)
    obs = s.observable()
    assert all(r["vm_pu"] is not None for r in obs.readings.values())
    assert not any(sw.kind == "tie" for sw in obs.switches)
    assert len(obs.metered_nodes) == len(obs.nodes)


def test_hard_has_four_feeders():
    s = generate_scenario(Complexity.HARD, seed=1)
    assert len(set(s.reveal()["feeder"].values())) >= 3  # 4 built; a reconfig may empty one


def test_load_profile_changes_voltages():
    s = generate_scenario(Complexity.MEDIUM, seed=4)
    peak = s.net.res_bus.vm_pu.min()
    s.solve(4)  # night valley
    assert s.net.res_bus.vm_pu.min() > peak


def test_network_has_overhead_and_underground_lines():
    kinds = {line["kind"] for line in generate_scenario(Complexity.HARD, seed=1).reveal()["lines"]}
    assert kinds == {"overhead", "underground"}


def test_protection_and_devices_present_in_hard():
    s = generate_scenario(Complexity.HARD, seed=1)
    obs = s.observable()
    assert {sw.kind for sw in obs.switches} >= {"tie", "sectionalizer", "recloser", "fuse"}
    assert {d.kind for d in obs.devices} == {"capacitor", "pv"}
    assert {n.mount for n in obs.nodes} == {"kiosk", "pole"}


def test_pv_follows_the_sun():
    s = generate_scenario(Complexity.HARD, seed=1)
    s.solve(12)
    noon = s.net.res_sgen.p_mw.sum()
    s.solve(22)
    assert noon > 0.5 and s.net.res_sgen.p_mw.sum() < 1e-6


@pytest.mark.parametrize("level", list(Complexity))
def test_every_node_has_its_own_city_block(level):
    obs = generate_scenario(level, seed=2).observable()
    locs = [n.location for n in obs.nodes]
    assert all(locs) and len(set(locs)) == len(locs)
    assert obs.substations[0].location[0] == -1  # substation outside the city


def test_line_lengths_follow_street_distance():
    from gridxray.lab.scenario import BLOCK_KM

    s = generate_scenario(Complexity.MEDIUM, seed=4)
    for _, line in s.net.line.iterrows():
        a, b = int(line.from_bus), int(line.to_bus)
        if s.roots[0] in (a, b):
            continue
        (ca, ra), (cb, rb) = s.location[a], s.location[b]
        blocks = max(1, abs(ca - cb) + abs(ra - rb))
        assert blocks * BLOCK_KM * 0.85 <= line.length_km <= blocks * BLOCK_KM * 1.3


def test_feeder_sections_connect_neighbouring_blocks():
    s = generate_scenario(Complexity.HARD, seed=6)
    for a, b in s.true_edges:
        if s.roots[0] in (a, b):
            continue
        (ca, ra), (cb, rb) = s.location[a], s.location[b]
        assert abs(ca - cb) + abs(ra - rb) <= 2


@pytest.mark.parametrize("ref", list(Reference))
def test_reference_networks_get_locations(ref):
    obs = load_reference(ref).observable()
    locs = [n.location for n in obs.nodes]
    assert all(locs) and len(set(locs)) == len(locs)
