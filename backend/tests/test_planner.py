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
