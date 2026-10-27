import dataclasses

import pytest

from gridxray.lab import Complexity, generate_scenario


@pytest.mark.parametrize("level", list(Complexity))
def test_scenario_is_radial_and_solved(level):
    s = generate_scenario(level, seed=1)
    n_mv = len(s.net.bus) - 1  # minus HV bus
    assert len(s.true_edges) == n_mv - 1  # tree
    assert s.net.converged
    assert s.net.res_bus.vm_pu.between(0.85, 1.1).all()


def test_same_seed_same_topology():
    assert generate_scenario(seed=7).true_edges == generate_scenario(seed=7).true_edges


def test_observable_view_hides_topology():
    obs = generate_scenario(seed=3).observable()
    fields = {f.name for f in dataclasses.fields(obs)}
    assert fields == {"nodes", "metered_nodes", "root"}
    assert len(obs.nodes) == 15 and obs.root not in obs.nodes  # MV nodes only


def test_hard_has_four_feeders():
    s = generate_scenario(Complexity.HARD, seed=1)
    heads = {b for a, b in s.true_edges if a == s.root} | {a for a, b in s.true_edges if b == s.root}
    assert len(heads) == 4
