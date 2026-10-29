from datetime import date

from fakes import ScriptedClient

from gridxray.agent.investigator import Investigator
from gridxray.agent.planner import make_plan, parse_plan_decision, plan_accuracy, plan_checks
from gridxray.lab import Complexity, generate_scenario

TODAY = date(2026, 10, 29)


def test_plans_range_from_true_to_old_and_wrong():
    s = generate_scenario(Complexity.MEDIUM, 2)
    assert make_plan(s, "none") is None
    current, old, wrong = (make_plan(s, k, today=TODAY) for k in ("current", "old", "errors"))
    acc = {k: plan_accuracy(s, p) for k, p in (("current", current), ("old", old), ("errors", wrong))}
    assert acc["current"]["correct"] == acc["current"]["total"]  # an up-to-date drawing is the real network
    assert acc["old"]["missing"] > 0 and acc["old"]["correct"] < acc["current"]["correct"]
    assert acc["errors"]["correct"] < acc["current"]["correct"]
    assert old.age_years(TODAY) > 8 > current.age_years(TODAY)  # the date tells how old the drawing is
    assert make_plan(s, "old", today=TODAY).parent == old.parent  # deterministic
    checks = plan_checks(s, wrong, s.observable().readings, None)
    assert checks["drawn_connections"] == len(wrong.parent)


def test_planner_decision_is_bounded():
    assert parse_plan_decision('{"budget": 99, "trust_in_plan": 3}') | {} == {"budget": 40, "trust_in_plan": 1.0}
    assert parse_plan_decision("no json")["budget"] == 0


def test_autonomous_investigation_lets_the_planner_choose_the_budget():
    s = generate_scenario(Complexity.EASY, 1)
    events = []
    client = ScriptedClient(s)
    inv = Investigator(s, client=client, on_event=lambda e: events.append(e.to_dict()),
                       plan=make_plan(s, "old", today=TODAY), autonomous=True, today=TODAY)
    inv.investigate()
    review = next(e for e in events if e["kind"] == "plan_review")
    started = next(e for e in events if e["kind"] == "started")
    assert client.planner_calls == 1 and review["budget"] == started["budget"] == 6
    assert review["plan"]["kind"] == "old" and review["plan"]["missing"]
    assert inv.run.toolbox.plan_trust == 0.8  # trusted: the drawing votes in the ensemble
    assert "plan" in {m for v in inv.run.toolbox.ensemble().votes.values() for ms in v.values() for m in ms}


def test_wrong_and_old_plans_always_differ_even_on_tiny_networks():
    from gridxray.lab.custom import Design, build_custom

    tiny = Design(name="t", substation_row=0, nodes=[
        {"key": "a", "name": "SS-A", "cell": (0, 0)}, {"key": "b", "name": "SS-B", "cell": (1, 0)},
        {"key": "c", "name": "SS-C", "cell": (0, 1)}, {"key": "d", "name": "SS-D", "cell": (1, 1)}],
        lines=[{"a": "S", "b": "a"}, {"a": "a", "b": "b"}, {"a": "a", "b": "c"}, {"a": "c", "b": "d"}])
    for seed in range(5):
        s = build_custom(tiny, seed)
        for kind in ("errors", "old"):
            acc = plan_accuracy(s, make_plan(s, kind, today=TODAY))
            assert acc["correct"] < acc["total"]  # a plan "with errors" is never accidentally right


def test_the_ai_is_never_told_what_kind_of_plan_it_has():
    """The agents get the drawing and its dates; whether it is current, old or wrong they must find out."""
    s = generate_scenario(Complexity.EASY, 1)
    for kind in ("current", "old", "errors"):
        events = []
        client = ScriptedClient(s)
        seen: list[str] = []
        original = client.respond

        def spy(model, input, seen=seen, original=original, **kw):
            seen.append(str(input) + str(kw.get("instructions", "")))
            return original(model, input, **kw)

        client.respond = spy
        inv = Investigator(s, client=client, on_event=lambda e, events=events: events.append(e.to_dict()),
                           plan=make_plan(s, kind, today=TODAY), autonomous=True, today=TODAY)
        inv.investigate()
        review = next(e for e in events if e["kind"] == "plan_review")
        assert "kind" not in review["planner_input"]["plan"]
        text = " ".join(seen) + str(inv.run.toolbox.t_get_overview())
        for word in ("with errors", "\"errors\"", "\"old\"", "\"current\"", "kind_"):
            assert word not in text, (kind, word)


def test_planner_adds_stages_after_a_field_failure():
    s = generate_scenario(Complexity.EASY, 1)
    events = []
    inv = Investigator(s, budget=8, client=ScriptedClient(s), on_event=lambda e: events.append(e.to_dict()))
    advice = inv.replan({"largest_shifts_pu": {"SS-03": -0.002}, "meters_offline": [], "suspect_sites": ["SS-03"],
                         "experiments_set_aside": 4})
    assert advice["extra_experiments_added"] == 3 and inv.run.toolbox.engine.budget == 11
    replan = next(e for e in events if e["kind"] == "replan")
    assert replan["budget"] == 11 and replan["decision"]["send_crew"]
    inv2 = Investigator(s, budget=39, client=ScriptedClient(s))
    assert inv2.replan({})["extra_experiments_added"] == 1  # never beyond the 40-experiment ceiling
