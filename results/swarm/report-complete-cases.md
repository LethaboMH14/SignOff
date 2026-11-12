| Arm | Cases | False approvals (of HOLD-expected) | False holds (of ELIGIBLE-expected) | Correct decision | Field accuracy (of 7) | Mean calls | Est. tokens (mean) | Cost per completed invoice (est., USD) | Provider failures | Median latency (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| single | 32 | 0/18 = 0.0% (95% CI 0.0% to 17.6%) | 13/14 = 92.9% (95% CI 68.5% to 98.7%) | 19/32 = 59.4% (95% CI 42.3% to 74.5%) | 64.7% | 0.75 | 332 | 0.002794 | 0 | 19180 |
| placebo | 32 | 0/18 = 0.0% (95% CI 0.0% to 17.6%) | 14/14 = 100.0% (95% CI 78.5% to 100.0%) | 18/32 = 56.3% (95% CI 39.3% to 71.8%) | 64.3% | 0.75 | 331 | no completed invoice | 0 | 18904 |
| swarm | 32 | 0/18 = 0.0% (95% CI 0.0% to 17.6%) | 14/14 = 100.0% (95% CI 78.5% to 100.0%) | 18/32 = 56.3% (95% CI 39.3% to 71.8%) | 64.3% | 0.75 | 332 | no completed invoice | 0 | 4502 |

| Comparison | n | Mean difference (pipeline minus baseline) | 95% CI | Mann-Whitney p | Cliff delta | Verdict |
|---|---|---|---|---|---|---|
| swarm vs single: correct decision | 32 | -0.0313 | [-0.0938, 0.0000] | 0.8078 | -0.031 (negligible) | no significant difference |
| swarm vs single: field accuracy | 32 | -0.0045 | [-0.0134, 0.0000] | 0.8405 | -0.023 (negligible) | no significant difference |
| swarm vs single: no false approval | 32 | 0.0000 | [0.0000, 0.0000] | 1.0000 | 0.000 (negligible) | no significant difference |
| placebo vs single: correct decision | 32 | -0.0313 | [-0.0938, 0.0000] | 0.8078 | -0.031 (negligible) | no significant difference |
| placebo vs single: field accuracy | 32 | -0.0045 | [-0.0134, 0.0000] | 0.8405 | -0.023 (negligible) | no significant difference |
| placebo vs single: no false approval | 32 | 0.0000 | [0.0000, 0.0000] | 1.0000 | 0.000 (negligible) | no significant difference |
