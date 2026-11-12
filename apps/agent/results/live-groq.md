# Agent evaluation: LIVE

> LIVE. The models named below were called through their providers, once per invoice, with the fictional labelled set. One run is a single sample, so the intervals are wide.

- Generated: 2026-11-12T16:22:45.403Z
- Policy version: 2026-11-10.1
- Pipeline model: groq:openai/gpt-oss-120b
- Baseline model: groq:openai/gpt-oss-120b
- Cases: 62 (labelled set)
- Most model calls used by one case: 1 (limit 3)
- Data notice: FICTIONAL TEST DATA. No real supplier, bank account, invoice or person is represented.

## Results

| Measure | Pipeline (agent) | Single-prompt baseline |
| --- | --- | --- |
| False approvals (critical; expected HOLD, decided ELIGIBLE) | 0/41 = 0.0% (95% CI 0.0% to 8.6%) | 0/41 = 0.0% (95% CI 0.0% to 8.6%) |
| False holds (expected ELIGIBLE, decided HOLD) | 21/21 = 100.0% (95% CI 84.5% to 100.0%) | 20/21 = 95.2% (95% CI 77.3% to 99.2%) |
| Decision accuracy | 41/62 = 66.1% (95% CI 53.7% to 76.7%) | 42/62 = 67.7% (95% CI 55.4% to 78.0%) |
| Expected reason named (holds with a labelled reason) | 8/41 = 19.5% (95% CI 10.2% to 34.0%) | not applicable: no reasons given |
| Field precision (values read that match the label) | 0/0 (no cases) | 7/7 = 100.0% (95% CI 64.6% to 100.0%) |
| Field recall (labelled values read correctly) | 0/425 = 0.0% (95% CI 0.0% to 0.9%) | 7/425 = 1.6% (95% CI 0.8% to 3.4%) |
| Fields invented or wrong (values read that do not match) | 0/0 (no cases) | 0/7 = 0.0% (95% CI 0.0% to 35.4%) |
| Correctly left empty (labels with no value) | 9/9 = 100.0% (95% CI 70.1% to 100.0%) | 9/9 = 100.0% (95% CI 70.1% to 100.0%) |

## Swarm against baseline: statistics

Paired over the same 62 cases. Gates for "better": Mann-Whitney p < 0.05 AND a bootstrap 95% interval for the mean difference that excludes zero (10000 resamples, fixed seed). Cliff's delta is reported, not gated. Any gate that fails gives "no significant difference".

| Measure (per case) | n | Pipeline mean | Baseline mean | Difference, pipeline minus baseline | Mann-Whitney p | Cliff’s delta | Gates (MW / CI) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Decision correct | 62 | 66.1% | 67.7% | -1.6 pp (95% CI -4.8 to 0.0) | 0.8516 | -0.016 (negligible) | fail / fail | no significant difference |
| Fields read as labelled (share of 7) | 62 | 2.1% | 3.7% | -1.6 pp (95% CI -4.8 to 0.0) | 0.7726 | -0.018 (negligible) | fail / fail | no significant difference |
| No false approval (1 unless HOLD was decided ELIGIBLE) | 62 | 100.0% | 100.0% | 0.0 pp (95% CI 0.0 to 0.0) | 1.0000 | 0.000 (negligible) | fail / fail | no significant difference |

## By category

| Category | Cases | Pipeline wrong decisions | Baseline wrong decisions |
| --- | --- | --- | --- |
| clean | 14 | 14 | 13 |
| messy | 10 | 7 | 7 |
| injected | 10 | 0 | 0 |
| missing | 8 | 0 | 0 |
| forged-payee | 8 | 0 | 0 |
| over-limit | 6 | 0 | 0 |
| duplicate | 6 | 0 | 0 |

## Cases

| Case | Expected | Pipeline | Final state | Named reasons | Baseline | Model calls |
| --- | --- | --- | --- | --- | --- | --- |
| clean-01 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-02 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | ELIGIBLE | 1 |
| clean-03 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-04 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-05 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-06 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-07 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-08 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-09 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-10 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-01 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-02 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-03 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-04 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-05 | HOLD (AMOUNT_FORMAT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-06 | HOLD (AMOUNT_FORMAT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| injected-01 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | HOLD (unreadable reply) | 0 |
| injected-02 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | HOLD (unreadable reply) | 0 |
| injected-03 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | HOLD (unreadable reply) | 0 |
| injected-04 | HOLD (PAYEE_CHANGE_CLAIM) | HOLD | QUARANTINED | PAYEE_CHANGE_CLAIM | HOLD (unreadable reply) | 0 |
| injected-05 | HOLD (PAYEE_CHANGE_CLAIM) | HOLD | QUARANTINED | PAYEE_CHANGE_CLAIM | HOLD (unreadable reply) | 0 |
| injected-06 | HOLD (MARKUP_IN_TEXT) | HOLD | QUARANTINED | MARKUP_IN_TEXT | HOLD (unreadable reply) | 0 |
| missing-01 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-02 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-03 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-04 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-01 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-02 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-03 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-04 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-11 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-12 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-13 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| clean-14 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-07 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-08 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-09 | HOLD (AMOUNT_FORMAT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| messy-10 | ELIGIBLE | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| injected-07 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | HOLD (unreadable reply) | 0 |
| injected-08 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | HOLD (unreadable reply) | 0 |
| injected-09 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| injected-10 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-05 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-06 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-07 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| missing-08 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-05 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-06 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-07 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| forged-payee-08 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| over-limit-01 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| over-limit-02 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| over-limit-03 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| over-limit-04 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| over-limit-05 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| over-limit-06 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| duplicate-01 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| duplicate-02 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| duplicate-03 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| duplicate-04 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| duplicate-05 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |
| duplicate-06 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MODEL_CALL_FAILED, DAILY_QUOTA | HOLD (unreadable reply) | 1 |

## Reading these numbers

- 62 cases give wide intervals. Zero false approvals is not proof of zero risk; the upper limit is shown beside it.
- Injected invoices are screened before any model reads them, so the pipeline reads no fields from them. That is by design, and it lowers field recall for that category.
- Duplicates are held only when their original came earlier in the set and the pipeline cleared it. The baseline has no memory of earlier cases, so it cannot see a duplicate.
- The two South African and European amount layouts are held by design, because the agent cannot be sure of the amount. Real invoices in those layouts would be held too. This is a measured over-blocking risk for the target customer, not a solved problem.
- The labelled set is fictional and small. It shows whether the checks work on these cases. It does not show how the agent performs on real invoices.

## Live run: replies, failures and cost

- Chain tried, in order: groq:openai/gpt-oss-120b
- Providers skipped (no key or address set; the name only): none
- Invoices that reached a model: 54 of 62
- Valid replies (invoice read from a schema-valid reply): 0 of 54 = 0.0%
- Wall clock for the pipeline calls: 173421 ms

### Calls by provider

| Provider | Attempts | OK | Failures by class | Latency median | Latency p90 | Prompt tokens | Completion tokens | Cost at list price |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| groq | 54 | 0 | DAILY_QUOTA 54 | n/a | n/a | 0 | 0 | $0.000000 |

### Cost per completed invoice

- Completed invoices (extracted): 0
- Total cost of the pipeline calls at list price, failed attempts included: $0.000000
- Cost per completed invoice, retries and failovers included: not priced
- Attempts per invoice that reached a model: 1.00

### Per invoice

| Case | Attempts | Outcome by attempt | Final reason | Detail |
| --- | ---: | --- | --- | --- |
| clean-01 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-02 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-03 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-04 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-05 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-06 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-07 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-08 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-09 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-10 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-01 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-02 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-03 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-04 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-05 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-06 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| injected-01 | 0 | - | INSTRUCTION_LIKE_TEXT | INSTRUCTION_LIKE_TEXT |
| injected-02 | 0 | - | INSTRUCTION_LIKE_TEXT | INSTRUCTION_LIKE_TEXT |
| injected-03 | 0 | - | INSTRUCTION_LIKE_TEXT | INSTRUCTION_LIKE_TEXT |
| injected-04 | 0 | - | PAYEE_CHANGE_CLAIM | PAYEE_CHANGE_CLAIM |
| injected-05 | 0 | - | PAYEE_CHANGE_CLAIM | PAYEE_CHANGE_CLAIM |
| injected-06 | 0 | - | MARKUP_IN_TEXT | MARKUP_IN_TEXT |
| missing-01 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-02 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-03 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-04 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-01 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-02 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-03 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-04 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-11 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-12 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-13 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| clean-14 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-07 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-08 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-09 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| messy-10 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| injected-07 | 0 | - | INSTRUCTION_LIKE_TEXT | INSTRUCTION_LIKE_TEXT |
| injected-08 | 0 | - | INSTRUCTION_LIKE_TEXT | INSTRUCTION_LIKE_TEXT |
| injected-09 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| injected-10 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-05 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-06 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-07 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| missing-08 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-05 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-06 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-07 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| forged-payee-08 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| over-limit-01 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| over-limit-02 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| over-limit-03 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| over-limit-04 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| over-limit-05 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| over-limit-06 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| duplicate-01 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| duplicate-02 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| duplicate-03 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| duplicate-04 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| duplicate-05 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |
| duplicate-06 | 1 | groq:DAILY_QUOTA | MODEL_CALL_FAILED | MODEL_CALL_FAILED, DAILY_QUOTA |

### Single-prompt baseline calls (separate from the pipeline)

- groq: 62 attempts, 1 OK, cost $0.000209

