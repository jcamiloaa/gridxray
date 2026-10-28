"""Benchmark: GridXray (Spark + Wonder) against the non-AI procedures over several scenarios.

Results are appended to a JSON file after every run, so a long benchmark can be resumed or
inspected while it is still going.
"""

import json
import time
from pathlib import Path

from gridxray.agent.investigator import Investigator
from gridxray.config import settings
from gridxray.lab import Complexity, generate_scenario
from gridxray.verify.score import score


def run_one(level: Complexity, seed: int, budget: int, wonder: bool = True) -> dict:
    cfg = settings if wonder else settings.model_copy(update={"max_wonder_reviews": 0})
    s = generate_scenario(level, seed)
    t0 = time.perf_counter()
    events: list[dict] = []
    run = Investigator(s, budget=budget, cfg=cfg, on_event=lambda e: events.append(e.to_dict())).investigate()
    tools_used = sorted({e["tool"] for e in events if e["kind"] == "tool_call"})
    row: dict = {"level": level.value, "seed": seed, "budget": budget, "wonder": wonder,
                 "steps": run.steps, "reviews": run.reviews, "tokens": run.tokens,
                 "cost_usd": run.usage_summary["cost_usd"], "tools_used": tools_used,
                 "meta_inference": any(e["kind"] == "meta_inference" for e in events),
                 "seconds": round(time.perf_counter() - t0, 1)}
    row["gridxray"] = (score(s, run.result["parent"], run.result["uncertain"], run.experiments_used).to_dict()
                       if run.result else None)
    return row


def summarize(rows: list[dict]) -> str:
    """GridXray against the real network: how much of the true topology it recovered."""
    lines = ["| Level | Seed | Budget | Correct / real | F1 | Wrong | Wrong flagged uncertain | Experiments | Meta inference | Reviews | Time |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        g = r["gridxray"]
        if not g:
            lines.append(f"| {r['level']} | {r['seed']} | {r['budget']} | no result | | | | | | | |")
            continue
        lines.append(f"| {r['level']} | {r['seed']} | {r['budget']} | **{g['correct_edges']}/{g['total_edges']}** | {g['f1']:.2f} | "
                     f"{g['wrong_edges']} | {g['wrong_and_flagged']}/{g['wrong_edges']} | {g['experiments']} | "
                     f"{'yes' if r.get('meta_inference') else 'no'} | {r['reviews']} | {r['seconds']:.0f}s |")
    by_level: dict[str, list[dict]] = {}
    for r in rows:
        if r["gridxray"]:
            by_level.setdefault(r["level"], []).append(r["gridxray"])
    lines += ["", "| Level | Runs | Correct / real (total) | Mean F1 | Wrong flagged as uncertain |", "|---|---|---|---|---|"]
    for lvl, gs in by_level.items():
        c, n = sum(g["correct_edges"] for g in gs), sum(g["total_edges"] for g in gs)
        w, f = sum(g["wrong_edges"] for g in gs), sum(g["wrong_and_flagged"] for g in gs)
        lines.append(f"| {lvl} | {len(gs)} | {c}/{n} ({c / n:.0%}) | {sum(g['f1'] for g in gs) / len(gs):.2f} | "
                     f"{f}/{w} ({f / w:.0%}) |" if w else f"| {lvl} | {len(gs)} | {c}/{n} | 1.00 | — |")
    return "\n".join(lines)


def benchmark(plan: list[tuple[Complexity, int, int]], out: Path, wonder: bool = True) -> list[dict]:
    rows: list[dict] = json.loads(out.read_text()) if out.exists() else []
    done = {(r["level"], r["seed"], r["budget"], r["wonder"]) for r in rows}
    for level, seed, budget in plan:
        if (level.value, seed, budget, wonder) in done:
            continue
        print(f"→ {level.value} seed={seed} budget={budget} wonder={wonder}", flush=True)
        try:
            row = run_one(level, seed, budget, wonder)
        except Exception as e:  # noqa: BLE001 - keep the benchmark going
            print(f"  failed: {type(e).__name__}: {e}", flush=True)
            continue
        rows.append(row)
        out.write_text(json.dumps(rows, indent=1))
        g = row["gridxray"]
        print(f"  GridXray {g['correct_edges']}/{g['total_edges']} F1={g['f1']} wrong={g['wrong_edges']} "
              f"flagged={g['wrong_and_flagged']} | {row['seconds']}s" if g else "  no result", flush=True)
    return rows
