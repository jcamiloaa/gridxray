import json
from types import SimpleNamespace

from fakes import ScriptedClient

from gridxray.agent.investigator import Investigator
from gridxray.config import settings
from gridxray.lab import Complexity, generate_scenario
from gridxray.sim import ExperimentEngine
from gridxray.tools import ToolBox
from gridxray.tools.reconstruct import Evidence, infer_tree
from gridxray.verify.baselines import exhaustive, geographic
from gridxray.verify.score import score


def test_perturbation_is_temporary_and_costs_budget():
    s = generate_scenario(Complexity.EASY, seed=1)
    before = s.net.res_bus.vm_pu.copy()
    eng = ExperimentEngine(s, budget=2)
    rec = eng.perturb_load(s.node_ids[-1], 1500)
    assert rec.accepted and eng.remaining == 1
    assert all(dv is None or dv <= 1e-3 for dv in rec.delta_vm.values())  # load lowers voltages
    assert (s.net.res_bus.vm_pu - before).abs().max() < 1e-9  # network restored


def test_limits_and_budget_reject_for_free():
    s = generate_scenario(Complexity.EASY, seed=1)
    eng = ExperimentEngine(s, budget=1)
    assert not eng.perturb_load(s.node_ids[0], 99_999).accepted
    assert eng.perturb_load(s.node_ids[0], 1000).accepted
    late = eng.perturb_load(s.node_ids[0], 1000)
    assert not late.accepted and "budget" in late.message


def test_exhaustive_recovers_easy_network_exactly():
    s = generate_scenario(Complexity.EASY, seed=2)
    r = exhaustive(s)
    assert score(s, r.candidate.parent).f1 == 1.0


def test_experiments_beat_geography_alone():
    s = generate_scenario(Complexity.MEDIUM, seed=3)
    assert score(s, exhaustive(s).candidate.parent).f1 > score(s, geographic(s).candidate.parent).f1


def test_ancestor_test_matches_truth():
    s = generate_scenario(Complexity.EASY, seed=1)
    eng = ExperimentEngine(s, budget=100)
    for n in s.node_ids:
        eng.perturb_load(n, 2000)
    ev = Evidence.from_records(eng.history)
    cand = infer_tree(s.observable(), ev)
    assert all(b == "measured" for b in cand.basis.values())


def test_toolbox_never_exposes_the_truth():
    s = generate_scenario(Complexity.HARD, seed=1)
    tb = ToolBox(s, budget=3)
    blob = json.dumps([tb.call("get_overview", {}), tb.call("get_evidence", {})])
    for leak in ("between", "feeder", "from_bus", "true_edges", "faulty", "overhead", "underground"):
        assert leak not in blob


# ---------------------------------------------------------------- orchestrator with a scripted model

def test_investigator_runs_the_tool_loop_and_wonder_review():
    s = generate_scenario(Complexity.EASY, seed=1)
    client = ScriptedClient(s)
    events = []
    run = Investigator(s, budget=5, client=client, on_event=events.append).investigate()
    kinds = {e.kind for e in events}
    assert run.result is not None and run.experiments_used == 2  # one experiment + the field crew
    assert {"tool_call", "experiment", "hypothesis", "review", "result"} <= kinds
    assert client.wonder_calls >= 1  # the requested review (plus the meta inference once half the budget is spent)


def test_investigator_recovers_when_the_server_drops_the_conversation():
    import openai

    s = generate_scenario(Complexity.EASY, seed=1)

    class Flaky(ScriptedClient):
        failed = False

        def respond(self, model, input, **kw):
            if kw.get("previous_response_id") and not self.failed:
                self.failed = True
                err = openai.BadRequestError.__new__(openai.BadRequestError)
                Exception.__init__(err, "Error code: 400 - referenced response not found or expired")
                raise err
            return super().respond(model, input, **kw)

    events = []
    run = Investigator(s, budget=5, client=Flaky(s), on_event=events.append).investigate()
    assert run.result is not None
    assert any(e.kind == "recovered" for e in events)


def test_restore_rebuilds_experiments_without_rerunning_them():
    s = generate_scenario(Complexity.EASY, seed=1)
    first = []
    Investigator(s, budget=5, client=ScriptedClient(s), on_event=lambda e: first.append(e.to_dict())).investigate()
    # cut the log just after the experiment, as if the service had restarted
    cut = next(i for i, e in enumerate(first) if e["kind"] == "experiment") + 1
    s2 = generate_scenario(Complexity.EASY, seed=1)
    inv = Investigator(s2, budget=5, client=ScriptedClient(s2), t_offset=first[cut - 1]["t"])
    inv.restore(first[:cut])
    assert inv.run.experiments_used == 1 and inv.run.toolbox.engine.remaining == 4
    ev = inv.run.toolbox.evidence()
    assert len(ev.depth) == 1  # the restored perturbation still counts as evidence


def test_usage_is_priced_per_model():
    from gridxray.pricing import cost_usd

    spark = cost_usd("muse-spark-1.3", {"input": 1_000_000, "cached": 0, "output": 1_000_000})
    wonder = cost_usd("muse-wonder-1.0", {"input": 1_000_000, "cached": 1_000_000, "output": 0})
    assert spark == 1.25 + 4.25 and wonder == 0.20


def test_batched_experiments_and_background_meta_inference():
    """One run_experiments call spends several units; Wonder's inference starts by itself at half budget."""
    from fakes import _call

    s = generate_scenario(Complexity.EASY, seed=2)
    names = [n.name for n in s.observable().nodes if n.metered][-3:]

    class Batcher(ScriptedClient):
        def respond(self, model, input, **kw):
            if model != settings.wonder_model and self.turn == 0:
                self.turn = 3  # skip the scripted single-experiment turns
                batch = [{"kind": "perturb_load", "node": n, "delta_kw": 2000} for n in names]
                return SimpleNamespace(id="b", output=[_call("run_experiments", {"experiments": batch}, 1)],
                                       output_text="", usage=None)
            return super().respond(model, input, **kw)

    events = []
    run = Investigator(s, budget=4, client=Batcher(s), on_event=events.append).investigate()
    kinds = [e.kind for e in events]
    assert run.experiments_used == 4 and kinds.count("experiment") == 3  # + the field crew
    assert [e.data["tool"] for e in events if e.kind == "tool_call" and e.data.get("auto")][:2] == ["get_overview", "passive_correlation"]
    assert "meta_inference" in kinds and kinds.index("meta_inference") < kinds.index("result")
    assert run.toolbox.meta_tree is not None and run.result is not None


def test_batch_fills_a_missing_load_size():
    s = generate_scenario(Complexity.EASY, seed=1)
    tb = ToolBox(s, budget=3)
    node = next(n.name for n in s.observable().nodes if n.metered)
    out = tb.call("run_experiments", {"experiments": [{"kind": "perturb_load", "node": node}, {"kind": "perturb_load"}]})
    assert out["results"][0]["accepted"] and out["results"][0]["args"]["delta_kw"] > 0
    assert not out["results"][1]["accepted"] and out["results"][1]["budget_remaining"] == 2


def test_rejection_explains_the_limit_and_a_safe_size_works():
    """CIGRE MV is heavily loaded: +2000 kW breaks a limit; the reason names no line or node, and safe_kw passes."""
    from gridxray.lab import Reference, load_reference

    tb = ToolBox(load_reference(Reference.CIGRE_MV, 0), budget=5)
    out = tb.call("run_experiment", {"kind": "perturb_load", "node": "SS-004", "delta_kw": 2000})
    r = out["rejection"]
    assert not out["accepted"] and out["budget_remaining"] == 5
    assert r["limit"] in {"voltage_low", "line_overload"} and r["value"] and 0 < r["safe_kw"] < 2000
    assert set(r) <= {"limit", "value", "threshold", "safe_kw"}  # margins only: nothing that locates the wiring
    assert tb.call("run_experiment", {"kind": "perturb_load", "node": "SS-004", "delta_kw": r["safe_kw"]})["accepted"]


def test_every_investigation_sends_a_field_crew():
    """Photo -> SAM 3.1 objects -> reading, checked against the switch records; costs one budget unit."""
    s = generate_scenario(Complexity.MEDIUM, seed=1)  # has a tie switch
    saved = []
    events = []
    inv = Investigator(s, budget=5, client=ScriptedClient(s), on_event=lambda e: events.append(e.to_dict()),
                       save_media=lambda data: saved.append(data) or f"m{len(saved)}")
    run = inv.investigate()
    kinds = [e["kind"] for e in events]
    for k in ("crew_dispatched", "field_photo", "segmentation", "field_reading"):
        assert k in kinds
    photo = next(e for e in events if e["kind"] == "field_photo")
    seg = next(e for e in events if e["kind"] == "segmentation")
    reading = next(e for e in events if e["kind"] == "field_reading")
    assert saved and photo["media_id"] == "m1" and "No company logos" in photo["prompt"]
    assert seg["objects"][0]["label"] in {"switch", "kiosk"} and seg["objects"][0]["box"] == [4, 4, 20, 30]
    assert reading["reading"]["switch_state"] == "closed" and reading["record_check"]
    assert run.experiments_used >= 2  # the scripted experiment plus the crew visit
    # the investigator only ever saw the reading: the simulator facts in the photo prompt never reach it
    crew_outputs = [e for e in events if e["kind"] == "tool_result" and e.get("tool") == "dispatch_crew"]
    assert all("real_position" not in str(e["output"]) for e in crew_outputs)
