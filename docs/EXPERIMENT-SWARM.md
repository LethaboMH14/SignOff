# Paired experiment: single prompt, placebo, and swarm

- **Status:** Run on the free Groq tier; **the swarm claim is not measured**. Read the limits first.
- **Date:** 12 November 2026 (run started 17:35 SAST; last pass finished 19:13 SAST)
- **Owner of the design:** Lane G (ADR [0008](decisions/0008-typed-graph-and-orchestrator.md))
- **Raw data:** `results/swarm/runs.jsonl` (final), `results/swarm/runs-pass1-rate-limited.jsonl`, `results/swarm/runs-pass2-rate-limited.jsonl` (kept as evidence, used for no claim)
- **Reports:** `results/swarm/report.md` (all 62 cases) and `results/swarm/report-complete-cases.md` (32 cases)
- **Code:** `apps/agent/src/experiment/` (`arms.ts`, `run.ts`, `report.ts`); commands `npm run agent:experiment-swarm` and `npm run agent:report-swarm`

## Limits, stated first

1. **The swarm arm never reached its reviewers.** Of 62 swarm runs, 33 stopped at verification (`VERIFY_HOLD`), 8 at the injection screen (`SCREEN_FLAGGED`), and 21 at a provider failure. None reached routing, so the procurement reviewer, the fraud reviewer and the judge produced no live output. The swarm's extra design (reviewers, judge, budget) is therefore **not tested by this run**.
2. **Most invoices stop before any comparison is possible.** The single arm held 28 of 62 at verification and 5 to 8 at the screen. Only 2 single-arm runs were approved, and the placebo arm approved none. Every arm holds almost everything, so the false-approval rate is near zero for every arm by construction, not by strength.
3. **Provider failures are not model verdicts.** The free Groq tier returned HTTP 429 for many calls. The workflow records a failed call as a hold, so counting failures as holds biases the false-hold rate. We report both the full table (failures included) and a complete-case table.
4. **Sender check and payment history are not modelled.** The labelled set has no sender headers and no history. The harness passes the sender check as `PASS` and the history as "not modelled". Any fraud-route result is therefore untested on this data.
5. **Token counts and cost are estimates.** Tokens are characters divided by four. Cost uses Groq's list price for `gpt-oss-120b` ($0.15 in, $0.60 out per million tokens), recorded in the ADR-0006 evidence. Neither is the provider's usage field.
6. **The extractor prompt in the logged hash is the versioned file, not the string sent.** Lane A's `extract.ts` holds its own system prompt (see the lane hand-over note). The hash in the decision log is of `prompts/v1/extractor.md`.
7. **The blind explanation-quality scorer (a different model family, length-balanced) is NOT MEASURED.** It was not built or run.

## Provider and model

- **Every arm and every case used `groq:openai/gpt-oss-120b`.** Each case's three arms used the same model and provider, so pairs are valid. Meta was not used for the labelled evaluation (ADR 0006, decision 8). A peer session asked for a Meta re-run on the owner's credit; that was declined in this session because the owner's recorded instruction says Meta is for probes only. It needs a direct decision from the owner.
- **Data:** the labelled set in `apps/agent/fixtures/labelled` (fictional, 62 invoices across seven categories). No real invoice was sent.

## Passes and failure counts

| Pass | Pacing between calls | Arm runs in file | Arm runs with a provider failure | What happened |
|---|---|---|---|---|
| 1 | 2.5 s | 186 | **118** (63%) | Full run. Kept in `runs-pass1-rate-limited.jsonl`. |
| 2 | 20 s | 186 (68 kept from pass 1 + 118 re-run) | **69** (37%) | Failed pairs re-run. Kept in `runs-pass2-rate-limited.jsonl`. |
| 3 | 40 s | 186 (117 kept from pass 2 + 69 re-run) | **64** (34%) | Failed pairs re-run again. Final file `runs.jsonl`. |

- All 64 pairs that failed in pass 3 had also failed in pass 2, and they are the same 64 case-arm pairs. A probe with a 185-character invoice returned HTTP 429 during the diagnosis, so the failures are provider-side, not an input-size issue we could find. We did not find the cause.
- Pass 3 was the last pass. Retrying again would have spent more of the free quota with no change in the outcome.

## Complete-case analysis (32 cases)

Only cases where all three arms completed with no provider failure are compared. This is the table to read for the comparisons. Its cases are not a random sample: they are the cases the free tier happened to serve.

| Arm | Cases | False approvals (of HOLD-expected) | False holds (of ELIGIBLE-expected) | Correct decision | Field accuracy (of 7) | Mean calls | Est. tokens (mean) | Cost per completed invoice (est., USD) | Provider failures | Median latency (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| single | 32 | 0/18 = 0.0% (95% CI 0.0% to 17.6%) | 13/14 = 92.9% (95% CI 68.5% to 98.7%) | 19/32 = 59.4% (95% CI 42.3% to 74.5%) | 64.7% | 0.75 | 332 | 0.002794 | 0 | 19180 |
| placebo | 32 | 0/18 = 0.0% (95% CI 0.0% to 17.6%) | 14/14 = 100.0% (95% CI 78.5% to 100.0%) | 18/32 = 56.3% (95% CI 39.3% to 71.8%) | 64.3% | 0.75 | 331 | no completed invoice | 0 | 18904 |
| swarm | 32 | 0/18 = 0.0% (95% CI 0.0% to 17.6%) | 14/14 = 100.0% (95% CI 78.5% to 100.0%) | 18/32 = 56.3% (95% CI 39.3% to 71.8%) | 64.3% | 0.75 | 332 | no completed invoice | 0 | 4502 |

| Comparison (n = 32) | Mean difference (pipeline minus baseline) | 95% CI | Mann-Whitney p | Cliff delta | Verdict |
|---|---|---|---|---|---|
| swarm vs single: correct decision | -0.0313 | [-0.0938, 0.0000] | 0.8078 | -0.031 (negligible) | no significant difference |
| swarm vs single: field accuracy | -0.0045 | [-0.0134, 0.0000] | 0.8405 | -0.023 (negligible) | no significant difference |
| swarm vs single: no false approval | 0.0000 | [0.0000, 0.0000] | 1.0000 | 0.000 (negligible) | no significant difference |
| placebo vs single: correct decision | -0.0313 | [-0.0938, 0.0000] | 0.8078 | -0.031 (negligible) | no significant difference |
| placebo vs single: field accuracy | -0.0045 | [-0.0134, 0.0000] | 0.8405 | -0.023 (negligible) | no significant difference |
| placebo vs single: no false approval | 0.0000 | [0.0000, 0.0000] | 1.0000 | 0.000 (negligible) | no significant difference |

## Full table (all 62 cases; failures counted as holds)

| Arm | Cases | False approvals (of HOLD-expected) | False holds (of ELIGIBLE-expected) | Correct decision | Field accuracy (of 7) | Mean calls | Est. tokens (mean) | Cost per completed invoice (est., USD) | Provider failures | Median latency (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| single | 62 | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 19/21 = 90.5% (95% CI 71.1% to 97.3%) | 43/62 = 69.4% (95% CI 57.0% to 79.4%) | 43.8% | 0.87 | 343 | 0.002368 | 23 | 19923 |
| placebo | 62 | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 21/21 = 100.0% (95% CI 84.5% to 100.0%) | 41/62 = 66.1% (95% CI 53.7% to 76.7%) | 46.1% | 0.87 | 347 | no completed invoice | 20 | 19836 |
| swarm | 62 | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 21/21 = 100.0% (95% CI 84.5% to 100.0%) | 41/62 = 66.1% (95% CI 53.7% to 76.7%) | 45.6% | 0.87 | 345 | no completed invoice | 21 | 20628 |

Comparisons on all 62 cases are in `results/swarm/report.md`: no significant difference on any measure (Mann-Whitney p from 0.70 to 1.00).

## Where each arm stopped (final file)

| Arm | Stopping point, by count |
|---|---|
| single | verification failed 28; instruction-like text 5; payee-change claim 2; markup 1; match failed 1; approved 2; provider failure 23 |
| placebo | verification failed 34; instruction-like text 5; payee-change claim 2; markup 1; provider failure 20 |
| swarm | verification failed (`VERIFY_HOLD`) 33; screen flagged 8; provider failure 21; reached routing 0 |

## Verdict

- **Swarm vs single prompt: NOT MEASURED.** The swarm's reviewers, judge and route ran zero times in live calls, so this run says nothing about whether reviewers improve decisions. The "no significant difference" rows above compare two identical extraction-and-verification paths.
- **Placebo vs single: no significant difference**, as expected for a neutral sentence. That is the noise floor for this set.
- **What the run does show:** the extraction-and-verification gate holds most fictional invoices (only 2 of 62 single-arm runs were approved). Field accuracy is about 65% on the complete cases. The bottleneck is extraction quality against the exact-quote rule, not the reviewers. This is a finding about the front half of the pipeline, and it is the first thing to fix before a swarm can be tested.
- **Next run needed:** a run where extraction passes often enough for the reviewers to run, with a paid or higher-quota provider and pacing that avoids the 429s, then the three gates on the reviewer effect. Until then, no claim that the swarm helps, hurts, or costs less.
