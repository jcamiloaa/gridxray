import time

import pytest
from fakes import ScriptedClient
from fastapi.testclient import TestClient

from gridxray.api.main import app
from gridxray.lab import Complexity, generate_scenario
from gridxray.lab.custom import Design, build_custom, design_from_scenario, validate_design
from gridxray.runs import manager
from gridxray.sim.engine import ExperimentEngine, apply_intervention


def small_design() -> Design:
    return Design(name="Test", substation_row=0, nodes=[
        {"key": "a", "name": "SS-A", "cell": (0, 0)}, {"key": "b", "name": "SS-B", "cell": (1, 0)},
        {"key": "c", "name": "SS-C", "cell": (1, 1)},
    ], lines=[
        {"a": "S", "b": "a"}, {"a": "a", "b": "b", "switch": {"kind": "sectionalizer"}},
        {"a": "a", "b": "c"}, {"a": "b", "b": "c", "switch": {"kind": "tie", "closed": False}},
    ])


def test_design_validation_explains_problems():
    assert validate_design(small_design()) == []
    looped = small_design()
    looped.lines[3].switch.closed = True
    assert any("loop" in e for e in validate_design(looped))
    cut = small_design()
    cut.lines = cut.lines[:1]
    assert any("No supply reaches" in e for e in validate_design(cut))


def test_designed_network_builds_and_round_trips():
    s = build_custom(small_design(), seed=1)
    names = {b: s.names[b] for b in s.names}
    assert {frozenset((names[a], names[b])) for a, b in s.true_edges} == {
        frozenset(("Substation", "SS-A")), frozenset(("SS-A", "SS-B")), frozenset(("SS-A", "SS-C"))}
    g = generate_scenario(Complexity.MEDIUM, 2)
    assert len(build_custom(design_from_scenario(g, "copy"), 2).true_edges) == len(g.true_edges)


def _transfer(s):
    """A safe reconfiguration: close the tie and open one other switch so the network stays radial."""
    tie = next(i for i, k in s.switch_kind.items() if k == "tie")
    for other in s.switch_kind:
        if other != tie and s.switch_kind[other] != "fuse" and apply_intervention(s, [tie, other], []) is None:
            return tie, other
    raise AssertionError("no radial transfer found")


def test_intervention_refuses_loops_and_is_noticed_by_the_agent():
    s = generate_scenario(Complexity.MEDIUM, 1)
    tie = next(i for i, k in s.switch_kind.items() if k == "tie")
    edges = set(s.true_edges)
    assert "loop" in apply_intervention(s, [tie], [])
    assert set(s.true_edges) == edges  # refused changes are fully undone

    eng = ExperimentEngine(s, budget=10)
    node = s.node_ids[-1]
    assert eng.perturb_load(node, 800).change is None
    assert eng.perturb_load(node, 800).change is None  # no change in the field: no alarm from noise
    _transfer(s)
    rec = eng.perturb_load(node, 800)
    assert rec.change and rec.change["shifts_pu"] and rec.epoch == 1 and set(s.true_edges) != edges


def test_meter_offline_is_noticed():
    s = generate_scenario(Complexity.EASY, 1)
    eng = ExperimentEngine(s, budget=5)
    eng.perturb_load(s.node_ids[0], 800)
    assert apply_intervention(s, [], [s.metered[2]]) is None
    rec = eng.perturb_load(s.node_ids[0], 800)
    assert rec.change["offline"] == [s.metered[2]]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(manager, "client_factory", lambda **kw: ScriptedClient(generate_scenario(Complexity.EASY, 1)))
    with TestClient(app) as c:
        c.post("/auth/demo")
        yield c
        deadline = time.monotonic() + 60
        while manager.running_count() and time.monotonic() < deadline:
            time.sleep(0.1)


def test_grid_api_and_investigation_on_a_designed_network(client):
    bad = small_design().model_dump()
    bad["lines"] = bad["lines"][:1]
    assert client.post("/grids", json=bad).status_code == 422
    tpl = client.get("/grids/template", params={"complexity": "easy", "seed": 1}).json()
    grid = client.post("/grids", json=tpl).json()
    assert grid["nodes"] == 15 and client.get("/grids").json()[0]["id"] == grid["id"]
    view = client.post(f"/grids/{grid['id']}/scenario").json()
    assert view["source"] == f"custom:{grid['id']}" and "edges" not in view  # wiring stays hidden
    run = client.post("/investigations", json={"grid": grid["id"], "budget": 5}).json()
    assert run["source"] == f"custom:{grid['id']}"
    deadline = time.monotonic() + 60
    while client.get(f"/investigations/{run['id']}").json()["status"] == "running" and time.monotonic() < deadline:
        time.sleep(0.2)
    body = client.get(f"/investigations/{run['id']}").json()
    assert body["status"] == "done" and body["score"]["gridxray"]["f1"] > 0
    with TestClient(app) as other:  # another demo browser cannot see or use it
        other.post("/auth/demo")
        assert other.get(f"/grids/{grid['id']}").status_code == 404


def test_live_intervention_api(client, monkeypatch):
    class Slow(ScriptedClient):
        def respond(self, model, input, **kw):
            time.sleep(1.5)
            return super().respond(model, input, **kw)

    monkeypatch.setattr(manager, "client_factory", lambda **kw: Slow(generate_scenario(Complexity.MEDIUM, 1)))
    run_id = client.post("/investigations", json={"complexity": "medium", "seed": 1, "budget": 6}).json()["id"]
    for _ in range(50):  # the panel opens once the investigator has its network
        r = client.get(f"/investigations/{run_id}/field")
        if r.status_code == 200:
            break
        time.sleep(0.1)
    field = r.json()
    tie = next(w for w in field["switches"] if w["kind"] == "tie")
    r = client.post(f"/investigations/{run_id}/intervene", json={"switches": [tie["id"]]})
    assert r.status_code == 409 and "loop" in r.json()["detail"]
    s = generate_scenario(Complexity.MEDIUM, 1)
    pair = _transfer(s)
    assert client.post(f"/investigations/{run_id}/intervene", json={"switches": list(pair)}).status_code == 200
    events = client.get(f"/investigations/{run_id}").json()["events"]
    iv = next(e for e in events if e["kind"] == "intervention")
    assert len(iv["commitment"]) == 64 and {w["id"] for w in iv["switches"]} == set(pair)
    assert client.get(f"/investigations/{run_id}/truth").status_code == 409  # not while running
    client.post(f"/investigations/{run_id}/stop")
    truth = client.get(f"/investigations/{run_id}/truth").json()
    assert truth["interventions"] == 1 and sorted(map(tuple, truth["truth"]["edges"])) == sorted(s.true_edges)
    assert sorted(map(tuple, truth["initial_edges"])) != sorted(s.true_edges)
    html = client.get(f"/investigations/{run_id}/report", params={"lang": "es"}).text
    assert "Incidencias en campo durante la investigación" in html and f"SW-{pair[0]}" in html
    assert "Verificado: la red real coincide con el sello." in html  # the seal still covers the start


def test_small_network_change_is_noticed():
    """Even where the baseline barely moves, the change shows in the readings or in a repeated experiment."""
    s = build_custom(small_design(), seed=3)
    b = next(n for n in s.node_ids if s.names[n] == "SS-B")
    eng = ExperimentEngine(s, budget=10)
    eng.perturb_load(b, 1500)
    assert apply_intervention(s, [0, 1], []) is None  # close the tie, open the sectionalizer: SS-B now fed via SS-C
    assert eng.perturb_load(b, 1500).change is not None
