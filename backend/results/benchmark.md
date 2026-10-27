# GridXray benchmark (v2)

Agent v2: physics-fit reconstruction, suggest_experiments tool, Muse Wonder midpoint review.
Previous run: benchmark_v1.md.

| Level | Seed | Budget | GridXray F1 (exp.) | Same-budget heuristic F1 | Exhaustive F1 (exp.) | Passive F1 | Geographic F1 | Reviews | Time |
|---|---|---|---|---|---|---|---|---|---|
| easy | 1 | 8 | **1.00** (8) | 0.73 | 1.00 (15) | 0.53 | 0.60 | 1 | 387s |
| easy | 2 | 8 | **0.73** (8) | 0.60 | 1.00 (15) | 0.60 | 0.60 | 1 | 395s |
| easy | 3 | 8 | **0.80** (8) | 0.87 | 1.00 (15) | 0.60 | 0.33 | 1 | 402s |
| medium | 1 | 15 | **0.60** (15) | 0.63 | 0.90 (30) | 0.40 | 0.27 | 1 | 940s |
| medium | 2 | 15 | **0.67** (15) | 0.67 | 0.93 (30) | 0.47 | 0.37 | 1 | 502s |
| medium | 3 | 15 | **0.60** (15) | 0.63 | 0.87 (30) | 0.50 | 0.33 | 1 | 578s |

| Level | Runs | GridXray mean F1 | Mean experiments | Exhaustive mean F1 | Exhaustive experiments |
|---|---|---|---|---|---|
| easy | 3 | 0.84 | 8.0 | 1.00 | 15 |
| medium | 3 | 0.62 | 15.0 | 0.90 | 30 |
