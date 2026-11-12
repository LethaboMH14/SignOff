| Arm | Cases | False approvals (of HOLD-expected) | False holds (of ELIGIBLE-expected) | Correct decision | Field accuracy (of 7) | Mean calls | Est. tokens (mean) | Cost per completed invoice (est., USD) | Provider failures | Median latency (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| single | 62 | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 19/21 = 90.5% (95% CI 71.1% to 97.3%) | 43/62 = 69.4% (95% CI 57.0% to 79.4%) | 43.8% | 0.87 | 343 | 0.002368 | 23 | 19923 |
| placebo | 62 | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 21/21 = 100.0% (95% CI 84.5% to 100.0%) | 41/62 = 66.1% (95% CI 53.7% to 76.7%) | 46.1% | 0.87 | 347 | no completed invoice | 20 | 19836 |
| swarm | 62 | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 21/21 = 100.0% (95% CI 84.5% to 100.0%) | 41/62 = 66.1% (95% CI 53.7% to 76.7%) | 45.6% | 0.87 | 345 | no completed invoice | 21 | 20628 |

| Comparison | n | Mean difference (pipeline minus baseline) | 95% CI | Mann-Whitney p | Cliff delta | Verdict |
|---|---|---|---|---|---|---|
| swarm vs single: correct decision | 62 | -0.0323 | [-0.0806, 0.0000] | 0.7043 | -0.032 (negligible) | no significant difference |
| swarm vs single: field accuracy | 62 | 0.0184 | [-0.0760, 0.1175] | 0.9932 | -0.001 (negligible) | no significant difference |
| swarm vs single: no false approval | 62 | 0.0000 | [0.0000, 0.0000] | 1.0000 | 0.000 (negligible) | no significant difference |
| placebo vs single: correct decision | 62 | -0.0323 | [-0.0806, 0.0000] | 0.7043 | -0.032 (negligible) | no significant difference |
| placebo vs single: field accuracy | 62 | 0.0230 | [-0.0899, 0.1359] | 0.9328 | -0.008 (negligible) | no significant difference |
| placebo vs single: no false approval | 62 | 0.0000 | [0.0000, 0.0000] | 1.0000 | 0.000 (negligible) | no significant difference |
