"""What judges can verify: benchmark, test results, guarantees and how results are scored."""

import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

RESULTS = Path(__file__).resolve().parents[2] / "results"

GUARANTEES = [
    {"claim": "The topology is sealed before every investigation",
     "how": "Before the AI sees anything, the server publishes SHA-256(secret + true topology). When the run ends the "
            "secret is revealed and your browser recomputes the hash from the revealed network: a match proves the "
            "network was fixed beforehand and never shown to the AI.",
     "tests": ["test_run_streams_events_and_scores"]},
    {"claim": "The AI never sees the true topology",
     "how": "Agents only receive the observable view (equipment, records, meter readings, city blocks) and experiment results. "
            "The wiring stays inside the simulator.",
     "tests": ["test_observable_view_hides_topology", "test_toolbox_never_exposes_the_truth"]},
    {"claim": "Scores are computed without any AI",
     "how": "An independent checker compares the proposed connections with the simulator's ground truth (precision, recall, F1).",
     "tests": ["test_edge_metrics_is_orientation_agnostic", "test_exhaustive_recovers_easy_network_exactly"]},
    {"claim": "Experiments respect physics and operating limits",
     "how": "Every experiment runs a real power flow (pandapower), is reverted afterwards, costs budget, and is rejected if it "
            "would leave 0.90–1.10 pu, overload a line or de-energize customers.",
     "tests": ["test_perturbation_is_temporary_and_costs_budget", "test_limits_and_budget_reject_for_free"]},
    {"claim": "Real Meta models, no scripted answers",
     "how": "Muse Spark drives the investigation through tool calls; Muse Wonder reviews on escalation. Every call, token and "
            "cost is logged in the investigation's event record.",
     "tests": ["test_investigator_runs_the_tool_loop_and_wonder_review"]},
    {"claim": "Investigations survive restarts",
     "how": "Events are stored as they happen; after a restart the run resumes from its log without repeating experiments.",
     "tests": ["test_restore_rebuilds_experiments_without_rerunning_them", "test_investigator_recovers_when_the_server_drops_the_conversation"]},
    {"claim": "Changes in the field are noticed, not announced",
     "how": "During a run you can operate switches or switch meters off. Unsafe operations are refused. The AI gets no "
            "notice: the experiment engine detects the change from baseline readings and repeated load steps against "
            "meter noise (no false alarms on unchanged networks), sets older experiments aside, and each change "
            "publishes a new commitment of the network.",
     "tests": ["test_intervention_refuses_loops_and_is_noticed_by_the_agent", "test_live_intervention_api",
               "test_small_network_change_is_noticed"]},
    {"claim": "Your own network is investigated like any other",
     "how": "Networks drawn in the editor are validated (every substation supplied, radial operation) and built into the "
            "same simulator; the AI sees substations and meters, never the wiring you drew.",
     "tests": ["test_design_validation_explains_problems", "test_grid_api_and_investigation_on_a_designed_network"]},
    {"claim": "Scenarios are physically consistent and reproducible",
     "how": "Seeded generation: same seed, same network. Radial operation, geography-consistent line lengths.",
     "tests": ["test_same_seed_same_scenario", "test_line_lengths_follow_street_distance", "test_synthetic_scenario_is_radial_and_solved"]},
]

SCORING = {
    "metric": "Every investigation is scored against the real network hidden in the simulator: how many of the true "
              "connections GridXray recovered (correct / real), F1 (balance of correct proposals and connections found), "
              "how many it got wrong, and how many of those it honestly flagged as uncertain.",
    "methods": {
        "Physics (non-AI)": "Virtual experiments on the pandapower model and a fit of the measured voltage drops.",
        "Traditional AI": "24 h correlation analysis: hierarchical clustering into feeders and a Chow-Liu tree; an "
                          "ensemble that measures where methods agree.",
        "Geography (non-AI)": "GIS city blocks and a voltage snapshot as a prior.",
        "Meta AI": "Muse Spark orchestrates the investigation and decides every experiment; Muse Wonder infers the "
                   "topology from the raw data (one ensemble vote) and reviews the evidence.",
    },
    "calibration": "Of the connections GridXray gets wrong, how many it flagged as uncertain.",
}

AREAS = {"test_lab": "Virtual lab", "test_sim_tools": "Experiments, tools and agent", "test_investigations_api": "Live investigations API",
         "test_auth": "Authentication", "test_metrics": "Scoring",
         "test_custom_and_intervention": "Designed networks and live intervention", "test_pricing_totals": "Usage and costs"}


def run_tests() -> dict:
    """Run the test suite and store a summary in results/tests.json."""
    backend = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory() as tmp:
        xml_path = Path(tmp) / "junit.xml"
        subprocess.run([sys.executable, "-m", "pytest", "-q", f"--junitxml={xml_path}"], cwd=backend, check=False)
        root = ET.parse(xml_path).getroot()
    suite = root if root.tag == "testsuite" else root.find("testsuite")
    tests = []
    for case in suite.iter("testcase"):
        outcome = "failed" if case.find("failure") is not None or case.find("error") is not None else (
            "skipped" if case.find("skipped") is not None else "passed")
        module = case.get("classname", "").split(".")[-1]
        tests.append({"name": case.get("name"), "area": AREAS.get(module, module), "outcome": outcome,
                      "seconds": round(float(case.get("time", 0)), 2)})
    summary = {"total": len(tests), "passed": sum(t["outcome"] == "passed" for t in tests),
               "failed": sum(t["outcome"] == "failed" for t in tests), "seconds": round(float(suite.get("time", 0)), 1),
               "tests": tests}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "tests.json").write_text(json.dumps(summary, indent=1))
    return summary


def _load(name: str):
    path = RESULTS / name
    return json.loads(path.read_text()) if path.exists() else None


def benchmark_summary(rows: list[dict]) -> list[dict]:
    """Per level: how much of the real topology GridXray recovered."""
    out = []
    for level in dict.fromkeys(r["level"] for r in rows):
        gs = [r["gridxray"] for r in rows if r["level"] == level and r.get("gridxray")]
        if not gs:
            continue
        correct, total = sum(g["correct_edges"] for g in gs), sum(g["total_edges"] for g in gs)
        wrong, flagged = sum(g["wrong_edges"] for g in gs), sum(g["wrong_and_flagged"] for g in gs)
        out.append({"level": level, "runs": len(gs), "budget": rows[0]["budget"] if rows else 0,
                    "budget_by_level": next(r["budget"] for r in rows if r["level"] == level),
                    "correct": correct, "total": total, "accuracy": round(correct / total, 3),
                    "f1": round(sum(g["f1"] for g in gs) / len(gs), 3),
                    "experiments": round(sum(g["experiments"] for g in gs) / len(gs), 1),
                    "wrong": wrong, "flagged": flagged, "calibration": round(flagged / wrong, 2) if wrong else 1.0,
                    "cost_usd": round(sum(r.get("cost_usd", 0) for r in rows if r["level"] == level and r.get("gridxray")) / len(gs), 3),
                    "seconds": round(sum(r.get("seconds", 0) for r in rows if r["level"] == level and r.get("gridxray")) / len(gs)),
                    "reviews": round(sum(r.get("reviews", 0) for r in rows if r["level"] == level and r.get("gridxray")) / len(gs), 1)})
    return out


def evidence(live_runs: list[dict] | None = None) -> dict:
    bench = _load("benchmark.json") or []
    with_wonder, spark_only = _load("ablation_wonder.json"), _load("ablation_spark.json")
    ablation = ({"with_wonder": benchmark_summary(with_wonder), "spark_only": benchmark_summary(spark_only)}
                if with_wonder and spark_only else None)
    return {
        "benchmark": {"rows": bench, "summary": benchmark_summary(bench)},
        "ablation": ablation,
        "tests": _load("tests.json"),
        "guarantees": GUARANTEES,
        "scoring": SCORING,
        "live": live_runs or [],
    }
