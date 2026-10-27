# GridXray benchmark

| Level | Seed | Budget | GridXray F1 (exp.) | Same-budget heuristic F1 | Exhaustive F1 (exp.) | Passive F1 | Geographic F1 | Reviews | Time |
|---|---|---|---|---|---|---|---|---|---|
| easy | 1 | 8 | **0.87** (8) | 0.73 | 1.00 (15) | 0.53 | 0.60 | 0 | 322s |
| easy | 2 | 8 | **1.00** (8) | 0.60 | 1.00 (15) | 0.60 | 0.60 | 0 | 411s |
| easy | 3 | 8 | **0.73** (8) | 0.67 | 1.00 (15) | 0.60 | 0.33 | 0 | 464s |
| medium | 1 | 15 | **0.57** (15) | 0.70 | 0.87 (30) | 0.40 | 0.27 | 0 | 620s |
| medium | 2 | 15 | **0.63** (15) | 0.63 | 0.77 (30) | 0.47 | 0.37 | 0 | 554s |
| medium | 3 | 15 | **0.57** (15) | 0.67 | 0.83 (30) | 0.50 | 0.33 | 0 | 390s |

| Level | Runs | GridXray mean F1 | Mean experiments | Exhaustive mean F1 | Exhaustive experiments |
|---|---|---|---|---|---|
| easy | 3 | 0.87 | 8.0 | 1.00 | 15 |
| medium | 3 | 0.59 | 15.0 | 0.82 | 30 |
