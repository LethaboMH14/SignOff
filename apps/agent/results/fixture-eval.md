# Agent evaluation: FIXTURE

> FIXTURE. No language model was called. The stand-ins are fixed rules that read the labelled layout. These figures test the agent’s code checks and the harness only. They are not a measurement of any model, and the model benefit is unverified.

- Generated: 2026-11-13T13:36:04.475Z
- Policy version: 2026-11-10.1
- Pipeline model: fixture (rule-based stand-in, no model called)
- Baseline model: simulated:rule-based-baseline
- Cases: 62 (labelled set)
- Most model calls used by one case: 1 (limit 3)
- Data notice: FICTIONAL TEST DATA. No real supplier, bank account, invoice or person is represented.

## Results

| Measure | Pipeline (agent) | Single-prompt baseline |
| --- | --- | --- |
| False approvals (critical; expected HOLD, decided ELIGIBLE) | 2/40 = 5.0% (95% CI 1.4% to 16.5%) | 32/40 = 80.0% (95% CI 65.2% to 89.5%) |
| False holds (expected ELIGIBLE, decided HOLD) | 1/22 = 4.5% (95% CI 0.8% to 21.8%) | 1/22 = 4.5% (95% CI 0.8% to 21.8%) |
| Decision accuracy | 59/62 = 95.2% (95% CI 86.7% to 98.3%) | 29/62 = 46.8% (95% CI 34.9% to 59.0%) |
| Expected reason named (holds with a labelled reason) | 38/40 = 95.0% (95% CI 83.5% to 98.6%) | not applicable: no reasons given |
| Field precision (values read that match the label) | 340/340 = 100.0% (95% CI 98.9% to 100.0%) | 407/407 = 100.0% (95% CI 99.1% to 100.0%) |
| Field recall (labelled values read correctly) | 340/425 = 80.0% (95% CI 75.9% to 83.5%) | 407/425 = 95.8% (95% CI 93.4% to 97.3%) |
| Fields invented or wrong (values read that do not match) | 0/340 = 0.0% (95% CI 0.0% to 1.1%) | 0/407 = 0.0% (95% CI 0.0% to 0.9%) |
| Correctly left empty (labels with no value) | 9/9 = 100.0% (95% CI 70.1% to 100.0%) | 9/9 = 100.0% (95% CI 70.1% to 100.0%) |

## Swarm against baseline: statistics

Paired over the same 62 cases. Gates for "better": Mann-Whitney p < 0.05 AND a bootstrap 95% interval for the mean difference that excludes zero (10000 resamples, fixed seed). Cliff's delta is reported, not gated. Any gate that fails gives "no significant difference".

| Measure (per case) | n | Pipeline mean | Baseline mean | Difference, pipeline minus baseline | Mann-Whitney p | Cliff’s delta | Gates (MW / CI) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Decision correct | 62 | 95.2% | 46.8% | 48.4 pp (95% CI 35.5 to 61.3) | 0.0000 | 0.484 (large) | pass / pass | pipeline better |
| Fields read as labelled (share of 7) | 62 | 80.4% | 95.9% | -15.4 pp (95% CI -25.3 to -7.1) | 0.0557 | -0.125 (negligible) | fail / pass | no significant difference |
| No false approval (1 unless HOLD was decided ELIGIBLE) | 62 | 96.8% | 48.4% | 48.4 pp (95% CI 35.5 to 61.3) | 0.0000 | 0.484 (large) | pass / pass | pipeline better |

## By category

| Category | Cases | Pipeline wrong decisions | Baseline wrong decisions |
| --- | --- | --- | --- |
| clean | 14 | 0 | 0 |
| messy | 10 | 1 | 1 |
| injected | 10 | 0 | 10 |
| missing | 8 | 0 | 2 |
| forged-payee | 8 | 0 | 8 |
| over-limit | 6 | 2 | 6 |
| duplicate | 6 | 0 | 6 |

## Cases

| Case | Expected | Pipeline | Final state | Named reasons | Baseline | Model calls |
| --- | --- | --- | --- | --- | --- | --- |
| clean-01 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-02 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-03 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-04 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-05 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-06 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-07 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-08 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-09 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-10 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-01 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-02 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-03 | HOLD (CURRENCY_NON_ZAR) | HOLD | QUARANTINED | CURRENCY_NON_ZAR | HOLD (unreadable reply) | 0 |
| messy-04 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-05 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-06 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| injected-01 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| injected-02 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| injected-03 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| injected-04 | HOLD (PAYEE_CHANGE_CLAIM) | HOLD | QUARANTINED | PAYEE_CHANGE_CLAIM | ELIGIBLE | 0 |
| injected-05 | HOLD (PAYEE_CHANGE_CLAIM) | HOLD | QUARANTINED | PAYEE_CHANGE_CLAIM | ELIGIBLE | 0 |
| injected-06 | HOLD (MARKUP_IN_TEXT) | HOLD | QUARANTINED | MARKUP_IN_TEXT | ELIGIBLE | 0 |
| missing-01 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, purchaseOrderNumber, FIELD_NOT_STATED | ELIGIBLE | 1 |
| missing-02 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, total, FIELD_NOT_STATED | HOLD | 1 |
| missing-03 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, invoiceNumber, FIELD_NOT_STATED | HOLD | 1 |
| missing-04 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, invoiceDate, FIELD_NOT_STATED | HOLD | 1 |
| forged-payee-01 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| forged-payee-02 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| forged-payee-03 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| forged-payee-04 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| clean-11 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-12 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-13 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| clean-14 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-07 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-08 | ELIGIBLE | HOLD | HELD | VERIFICATION_FAILED, invoiceDate, FIELD_NOT_STATED | HOLD | 1 |
| messy-09 | ELIGIBLE | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| messy-10 | HOLD (CURRENCY_NON_ZAR) | HOLD | QUARANTINED | CURRENCY_NON_ZAR | HOLD (unreadable reply) | 0 |
| injected-07 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| injected-08 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| injected-09 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| injected-10 | HOLD (INSTRUCTION_LIKE_TEXT) | HOLD | QUARANTINED | INSTRUCTION_LIKE_TEXT | ELIGIBLE | 0 |
| missing-05 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, purchaseOrderNumber, FIELD_NOT_STATED | ELIGIBLE | 1 |
| missing-06 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, invoiceDate, FIELD_NOT_STATED | HOLD | 1 |
| missing-07 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, total, FIELD_NOT_STATED | HOLD | 1 |
| missing-08 | HOLD (FIELD_NOT_STATED) | HOLD | HELD | VERIFICATION_FAILED, invoiceNumber, FIELD_NOT_STATED, purchaseOrderNumber | HOLD | 1 |
| forged-payee-05 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| forged-payee-06 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| forged-payee-07 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| forged-payee-08 | HOLD (PAYEE_CHANGED) | HOLD | HELD | MATCH_FAILED, PAYEE_CHANGED | ELIGIBLE | 1 |
| over-limit-01 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MATCH_FAILED, AMOUNT_EXCEEDS_ORDER, AMOUNT_EXCEEDS_RECEIPT | ELIGIBLE | 1 |
| over-limit-02 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MATCH_FAILED, AMOUNT_EXCEEDS_ORDER, AMOUNT_EXCEEDS_RECEIPT | ELIGIBLE | 1 |
| over-limit-03 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MATCH_FAILED, AMOUNT_EXCEEDS_ORDER, AMOUNT_EXCEEDS_RECEIPT | ELIGIBLE | 1 |
| over-limit-04 | HOLD (AMOUNT_EXCEEDS_ORDER) | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| over-limit-05 | HOLD (AMOUNT_EXCEEDS_ORDER) | HOLD | HELD | MATCH_FAILED, AMOUNT_EXCEEDS_ORDER, AMOUNT_EXCEEDS_RECEIPT | ELIGIBLE | 1 |
| over-limit-06 | HOLD (AMOUNT_EXCEEDS_ORDER) | ELIGIBLE | WARDEN_ELIGIBLE | OK | ELIGIBLE | 1 |
| duplicate-01 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MATCH_FAILED, DUPLICATE_PAYMENT | ELIGIBLE | 1 |
| duplicate-02 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MATCH_FAILED, DUPLICATE_PAYMENT | ELIGIBLE | 1 |
| duplicate-03 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MATCH_FAILED, DUPLICATE_PAYMENT | ELIGIBLE | 1 |
| duplicate-04 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MATCH_FAILED, DUPLICATE_PAYMENT | ELIGIBLE | 1 |
| duplicate-05 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MATCH_FAILED, DUPLICATE_PAYMENT | ELIGIBLE | 1 |
| duplicate-06 | HOLD (DUPLICATE_PAYMENT) | HOLD | HELD | MATCH_FAILED, DUPLICATE_PAYMENT | ELIGIBLE | 1 |

## Reading these numbers

- 62 cases give wide intervals. Zero false approvals is not proof of zero risk; the upper limit is shown beside it.
- Injected invoices are screened before any model reads them, so the pipeline reads no fields from them. That is by design, and it lowers field recall for that category.
- Duplicates are held only when their original came earlier in the set and the pipeline cleared it. The baseline has no memory of earlier cases, so it cannot see a duplicate.
- The two South African and European amount layouts are held by design, because the agent cannot be sure of the amount. Real invoices in those layouts would be held too. This is a measured over-blocking risk for the target customer, not a solved problem.
- The labelled set is fictional and small. It shows whether the checks work on these cases. It does not show how the agent performs on real invoices.

