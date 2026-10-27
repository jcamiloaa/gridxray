import argparse

from gridxray.lab import Complexity, generate_scenario


def main() -> None:
    parser = argparse.ArgumentParser(prog="gridxray")
    sub = parser.add_subparsers(dest="cmd", required=True)
    gen = sub.add_parser("generate", help="Generate a scenario and print a summary")
    gen.add_argument("--level", type=Complexity, default=Complexity.EASY)
    gen.add_argument("--seed", type=int, default=0)
    sub.add_parser("ping", help="Check Meta Model API access (Spark tool calling + Wonder)")
    args = parser.parse_args()

    if args.cmd == "generate":
        s = generate_scenario(args.level, args.seed)
        vm = s.net.res_bus.vm_pu
        print(f"{s.complexity} seed={s.seed}: {len(s.true_edges)} lines, "
              f"{len(s.metered_nodes)} meters, V=[{vm.min():.3f}, {vm.max():.3f}] pu")
    elif args.cmd == "ping":
        from gridxray.agent.ping import ping

        ping()
