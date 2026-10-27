"""What judges can verify: benchmark, test results, guarantees and how results are scored."""

import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

RESULTS = Path(__file__).resolve().parents[2] / "results"

GUARANTEES = [
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
    {"claim": "Scenarios are physically consistent and reproducible",
     "how": "Seeded generation: same seed, same network. Radial operation, geography-consistent line lengths.",
     "tests": ["test_same_seed_same_scenario", "test_line_lengths_follow_street_distance", "test_synthetic_scenario_is_radial_and_solved"]},
]

SCORING = {
    "metric": "F1 over connections: the harmonic mean of precision (share of proposed connections that really exist) and "
              "recall (share of real connections found). 1.00 = the exact network.",
    "baselines": {
        "geographic": "GIS + one voltage snapshot, no experiments: each kiosk hangs from its most upstream-looking neighbour.",
        "passive": "24 hourly voltage snapshots, no experiments: neighbours whose voltages move together share a feeder.",
        "heuristic": "Same experiment budget as the AI, no AI: probe the farthest blocks first, then a fixed random sample.",
        "exhaustive": "Perturb every secondary substation once (one experiment per node), then reconstruct.",
    },
    "calibration": "Of the connections the AI gets wrong, how many it flagged as uncertain.",
}

AREAS = {"test_lab": "Virtual lab", "test_sim_tools": "Experiments, tools and agent", "test_investigations_api": "Live investigations API",
         "test_auth": "Authentication", "test_metrics": "Scoring"}


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
    methods = ["gridxray", "heuristic", "exhaustive", "passive", "geographic"]
    out = []
    for level in dict.fromkeys(r["level"] for r in rows):
        rs = [r for r in rows if r["level"] == level]
        row = {"level": level, "runs": len(rs), "budget": rs[0]["budget"]}
        for m in methods:
            vals = [r[m] for r in rs if r.get(m)]
            if vals:
                row[m] = {"f1": round(sum(v["f1"] for v in vals) / len(vals), 3),
                          "experiments": round(sum(v["experiments"] for v in vals) / len(vals), 1)}
        g = [r["gridxray"] for r in rs if r.get("gridxray")]
        if g:
            wrong = sum(v["wrong_edges"] for v in g)
            row["calibration"] = round(sum(v["wrong_and_flagged"] for v in g) / wrong, 2) if wrong else 1.0
        out.append(row)
    return out


def evidence(live_runs: list[dict] | None = None) -> dict:
    bench = _load("benchmark.json") or []
    return {
        "benchmark": {"rows": bench, "summary": benchmark_summary(bench)},
        "tests": _load("tests.json"),
        "guarantees": GUARANTEES,
        "scoring": SCORING,
        "live": live_runs or [],
    }
