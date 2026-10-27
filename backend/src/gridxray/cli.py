import argparse
import json

from gridxray.lab import Complexity, Reference, generate_scenario, load_reference


def _scenario(args):
    return load_reference(args.reference, args.seed) if args.reference else generate_scenario(args.level, args.seed)


def _add_scenario_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--level", type=Complexity, default=Complexity.EASY)
    p.add_argument("--reference", type=Reference, default=None)
    p.add_argument("--seed", type=int, default=0)


def main() -> None:
    parser = argparse.ArgumentParser(prog="gridxray")
    sub = parser.add_subparsers(dest="cmd", required=True)
    _add_scenario_args(sub.add_parser("generate", help="Generate a scenario and print a summary"))
    sub.add_parser("ping", help="Check Meta Model API access (Spark tool calling + Wonder)")
    _add_scenario_args(sub.add_parser("baselines", help="Score the non-AI reference procedures"))
    inv = sub.add_parser("investigate", help="Run a real Muse Spark + Muse Wonder investigation")
    _add_scenario_args(inv)
    inv.add_argument("--budget", type=int, default=None)
    inv.add_argument("--effort", default=None, help="Spark reasoning effort (minimal..max)")
    inv.add_argument("--log", default=None, help="Write the full event log to this JSON file")
    sub.add_parser("evidence", help="Run the test suite and store results/tests.json for the Evidence page")
    bench = sub.add_parser("benchmark", help="Run GridXray and the baselines over several scenarios")
    bench.add_argument("--plan", default="easy:1-3:8,medium:1-3:15",
                       help="level:seeds:budget,... e.g. easy:1-3:8,medium:1-3:15,hard:1-2:30")
    bench.add_argument("--out", default="benchmark.json")
    bench.add_argument("--no-wonder", action="store_true", help="Ablation: Spark only")
    args = parser.parse_args()

    if args.cmd == "generate":
        s = _scenario(args)
        vm = s.net.res_bus.vm_pu
        print(f"{s.source} seed={s.seed}: {len(s.true_edges)} energized lines, "
              f"{len(s.metered)} meters, V=[{vm.min():.3f}, {vm.max():.3f}] pu")
    elif args.cmd == "ping":
        from gridxray.agent.ping import ping

        ping()
    elif args.cmd == "baselines":
        from gridxray.verify.baselines import exhaustive, geographic, passive
        from gridxray.verify.score import score

        s = _scenario(args)
        for f in (geographic, passive, exhaustive):
            r = f(s)
            sc = score(s, r.candidate.parent, experiments=r.experiments)
            print(f"{r.name:<11} F1={sc.f1:.2f}  correct {sc.correct_edges}/{sc.total_edges}  experiments={sc.experiments}")
    elif args.cmd == "investigate":
        _investigate(args)
    elif args.cmd == "evidence":
        from gridxray.evidence import run_tests

        s = run_tests()
        print(f"{s['passed']}/{s['total']} tests passed in {s['seconds']}s -> results/tests.json")
    elif args.cmd == "benchmark":
        from pathlib import Path

        from gridxray.verify.benchmark import benchmark, summarize

        plan = []
        for item in args.plan.split(","):
            level, seeds, budget = item.split(":")
            lo, _, hi = seeds.partition("-")
            plan += [(Complexity(level), s, int(budget)) for s in range(int(lo), int(hi or lo) + 1)]
        rows = benchmark(plan, Path(args.out), wonder=not args.no_wonder)
        print(summarize(rows))


def _investigate(args) -> None:
    from gridxray.agent.investigator import Event, Investigator
    from gridxray.config import settings
    from gridxray.verify.baselines import exhaustive, geographic, passive
    from gridxray.verify.score import score

    cfg = settings.model_copy(update={"spark_reasoning_effort": args.effort}) if args.effort else settings
    s = _scenario(args)

    def show(ev: Event) -> None:
        d = ev.data
        if ev.kind == "tool_call":
            brief = {k: v for k, v in d["args"].items() if k not in ("edges", "edges_a", "edges_b")}
            extra = f" ({len(d['args']['edges'])} edges)" if "edges" in d["args"] else ""
            print(f"[{ev.t:6.1f}s] → {d['tool']} {json.dumps(brief)}{extra}")
        elif ev.kind == "experiment":
            print(f"          experiment #{d.get('experiment')} {d.get('message')} · budget left {d.get('budget_remaining')}")
        elif ev.kind in ("hypothesis",):
            print(f"          💡 {d['statement']} (confidence {d['confidence']})")
        elif ev.kind == "reasoning":
            print(f"          · {d['text'][:220]}")
        elif ev.kind == "review":
            print(f"[{ev.t:6.1f}s] 🔎 Muse Wonder ({d['trigger']}):\n          {d['advice'][:600]}")
        elif ev.kind in ("result", "error", "message"):
            print(f"[{ev.t:6.1f}s] {ev.kind}: {d.get('summary') or d.get('message') or d.get('text')}")

    inv = Investigator(s, budget=args.budget, cfg=cfg, on_event=show)
    run = inv.investigate()
    print("\n=== Verification (independent of the models) ===")
    if run.result:
        sc = score(s, run.result["parent"], run.result["uncertain"], run.experiments_used)
        print(f"GridXray    F1={sc.f1:.2f}  correct {sc.correct_edges}/{sc.total_edges}  experiments={sc.experiments}  "
              f"wrong={sc.wrong_edges} (flagged uncertain: {sc.wrong_and_flagged}/{sc.uncertain_flagged})")
    else:
        print("GridXray    no result submitted")
    for f in (geographic, passive, exhaustive):
        r = f(s)
        b = score(s, r.candidate.parent, experiments=r.experiments)
        print(f"{r.name:<11} F1={b.f1:.2f}  correct {b.correct_edges}/{b.total_edges}  experiments={b.experiments}")
    print(f"steps={run.steps} reviews={run.reviews} tokens={run.tokens} time={run.seconds:.0f}s")
    if args.log:
        with open(args.log, "w") as fh:
            json.dump({"events": [e.to_dict() for e in run.events],
                       "score": sc.to_dict() if run.result else None}, fh, indent=1, default=str)
