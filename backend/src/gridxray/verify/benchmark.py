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
from gridxray.verify.baselines import exhaustive, geographic, heuristic, passive
from gridxray.verify.score import score


def run_one(level: Complexity, seed: int, budget: int, wonder: bool = True) -> dict:
    cfg = settings if wonder else settings.model_copy(update={"max_wonder_reviews": 0})
    s = generate_scenario(level, seed)
    t0 = time.perf_counter()
    run = Investigator(s, budget=budget, cfg=cfg).investigate()
    row: dict = {"level": level.value, "seed": seed, "budget": budget, "wonder": wonder,
                 "steps": run.steps, "reviews": run.reviews, "tokens": run.tokens,
                 "seconds": round(time.perf_counter() - t0, 1)}
    row["gridxray"] = (score(s, run.result["parent"], run.result["uncertain"], run.experiments_used).to_dict()
                       if run.result else None)
    for f in (geographic, passive, lambda sc: heuristic(sc, budget), exhaustive):
        b = f(generate_scenario(level, seed))
        row[b.name] = score(generate_scenario(level, seed), b.candidate.parent, experiments=b.experiments).to_dict()
    return row


def summarize(rows: list[dict]) -> str:
    lines = ["| Level | Seed | Budget | GridXray F1 (exp.) | Same-budget heuristic F1 | Exhaustive F1 (exp.) | Passive F1 | Geographic F1 | Reviews | Time |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        g = r["gridxray"]
        gx = f"**{g['f1']:.2f}** ({g['experiments']})" if g else "no result"
        heur = f"{r['heuristic']['f1']:.2f}" if "heuristic" in r else "—"
        lines.append(f"| {r['level']} | {r['seed']} | {r['budget']} | {gx} | {heur} | {r['exhaustive']['f1']:.2f} "
                     f"({r['exhaustive']['experiments']}) | {r['passive']['f1']:.2f} | {r['geographic']['f1']:.2f} | "
                     f"{r['reviews']} | {r['seconds']:.0f}s |")
    by_level: dict[str, list[dict]] = {}
    for r in rows:
        by_level.setdefault(r["level"], []).append(r)
    lines += ["", "| Level | Runs | GridXray mean F1 | Mean experiments | Exhaustive mean F1 | Exhaustive experiments |",
              "|---|---|---|---|---|---|"]
    for lvl, rs in by_level.items():
        ok = [r for r in rs if r["gridxray"]]
        mean = lambda xs: sum(xs) / len(xs) if xs else float("nan")
        lines.append(f"| {lvl} | {len(rs)} | {mean([r['gridxray']['f1'] for r in ok]):.2f} | "
                     f"{mean([r['gridxray']['experiments'] for r in ok]):.1f} | {mean([r['exhaustive']['f1'] for r in rs]):.2f} | "
                     f"{mean([r['exhaustive']['experiments'] for r in rs]):.0f} |")
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
        print(f"  GridXray F1={g['f1'] if g else None} exp={g['experiments'] if g else '-'} | "
              f"exhaustive F1={row['exhaustive']['f1']} exp={row['exhaustive']['experiments']} | {row['seconds']}s", flush=True)
    return rows
