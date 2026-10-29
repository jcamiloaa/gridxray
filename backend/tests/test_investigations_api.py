import json
import time

import pytest
from fakes import ScriptedClient
from fastapi.testclient import TestClient

from gridxray.api.main import app
from gridxray.lab import Complexity, generate_scenario
from gridxray.runs import manager


def wait_done(client, run_id: str, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/investigations/{run_id}").json()
        if body["status"] != "running":
            return body
        time.sleep(0.1)
    return body


@pytest.fixture
def client(monkeypatch):
    # the scripted model plays Spark/Wonder; it plans moves for the same scenario the run builds
    monkeypatch.setattr(manager, "client_factory", lambda **kw: ScriptedClient(generate_scenario(Complexity.EASY, 1)))
    with TestClient(app) as c:
        c.post("/auth/demo")
        yield c
        # let background investigations finish so tests never compete for the concurrency limit
        deadline = time.monotonic() + 60
        while manager.running_count() and time.monotonic() < deadline:
            time.sleep(0.1)


def test_requires_login():
    with TestClient(app) as c:
        assert c.post("/investigations", json={}).status_code == 401
        assert c.get("/evidence").status_code == 401  # evidence is not public


def test_run_streams_events_and_scores(client):
    r = client.post("/investigations", json={"complexity": "easy", "seed": 1, "budget": 5})
    assert r.status_code == 201
    run_id = r.json()["id"]
    body = wait_done(client, run_id)
    assert body["status"] == "done"
    kinds = [e["kind"] for e in body["events"]]
    assert kinds[0] == "sealed" and kinds[1] == "started" and kinds[-1] == "done"
    assert {"candidate", "experiment", "review", "result"} <= set(kinds)
    assert body["score"]["gridxray"]["f1"] > 0  # scored against the real network

    # the seal published before the run opens afterwards and matches the hidden topology
    sealed = body["events"][0]
    assert len(sealed["commitment"]) == 64 and "between" not in str(sealed["ai_input"])
    seal = client.get(f"/investigations/{run_id}/seal").json()
    assert seal["recomputed"] == seal["published_commitment"] == sealed["commitment"]
    # every tool result the AI received is in the audit trail
    assert all("output" in e for e in body["events"] if e["kind"] == "tool_result")

    with client.stream("GET", f"/investigations/{run_id}/events") as s:  # finished runs replay from the DB copy
        text = "".join(s.iter_text())
    events = [json.loads(line[5:]) for line in text.splitlines() if line.startswith("data:")]
    assert events[-1]["kind"] == "done"
    # a dropped connection resumes after the last event it received, without repeats
    with client.stream("GET", f"/investigations/{run_id}/events", params={"since": len(events) - 2}) as s:
        tail = [json.loads(line[5:]) for line in "".join(s.iter_text()).splitlines() if line.startswith("data:")]
    assert [e["kind"] for e in tail] == [e["kind"] for e in events[-2:]]


def test_list_usage_and_resume_flow(client):
    run_id = client.post("/investigations", json={"complexity": "easy", "seed": 1, "budget": 5}).json()["id"]
    wait_done(client, run_id)
    runs = client.get("/investigations").json()
    assert runs[0]["id"] == run_id and runs[0]["status"] == "done"
    usage = client.get("/investigations/usage").json()
    assert "muse-spark-1.3" in usage["prices"] and usage["runs"] >= 1
    assert client.post(f"/investigations/{run_id}/resume").status_code == 409  # finished runs are not resumed


def test_demo_sessions_do_not_see_each_others_runs(client):
    run_id = client.post("/investigations", json={"complexity": "easy", "seed": 1, "budget": 5}).json()["id"]
    with TestClient(app) as other:
        other.post("/auth/demo")
        assert other.get(f"/investigations/{run_id}").status_code == 404
        assert all(r["id"] != run_id for r in other.get("/investigations").json())


def test_runs_survive_sign_out_in_the_same_browser(client):
    run_id = client.post("/investigations", json={"complexity": "easy", "seed": 1, "budget": 5}).json()["id"]
    client.post("/auth/logout")
    client.post("/auth/demo")  # same browser: the device cookie is kept
    assert any(r["id"] == run_id for r in client.get("/investigations").json())


def test_report_and_evidence(client):
    run_id = client.post("/investigations", json={"complexity": "easy", "seed": 1, "budget": 5, "language": "es"}).json()["id"]
    wait_done(client, run_id)
    html = client.get(f"/investigations/{run_id}/report").text
    assert "Informe de investigación GridXray" in html and "Resultado verificado" in html
    ev = client.get("/evidence").json()
    assert len(ev["guarantees"]) >= 5 and "metric" in ev["scoring"]


def test_stop_is_immediate_even_while_the_model_is_thinking(client, monkeypatch):
    """STOP closes the run at once; whatever the model answers afterwards is ignored."""

    class Slow(ScriptedClient):
        def respond(self, model, input, **kw):
            time.sleep(3)  # a long model call in flight
            return super().respond(model, input, **kw)

    monkeypatch.setattr(manager, "client_factory", lambda **kw: Slow(generate_scenario(Complexity.EASY, 1)))
    run_id = client.post("/investigations", json={"complexity": "easy", "seed": 1, "budget": 5}).json()["id"]
    time.sleep(0.5)
    t0 = time.monotonic()
    assert client.post(f"/investigations/{run_id}/stop").status_code == 200
    body = client.get(f"/investigations/{run_id}").json()
    assert time.monotonic() - t0 < 1.5 and body["status"] == "stopped"
    assert [e["kind"] for e in body["events"]][-2:] == ["stopped", "done"]
    time.sleep(3.5)  # the abandoned model call returns: nothing more is recorded
    after = client.get(f"/investigations/{run_id}").json()
    assert after["status"] == "stopped" and len(after["events"]) == len(body["events"])
    assert not any(e["kind"] == "experiment" for e in after["events"])
