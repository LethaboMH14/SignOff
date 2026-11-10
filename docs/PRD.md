# Product requirements: SignOff

- **Version:** 1.0, 10 November 2026
- **Status:** Agreed scope for the hackathon build. Nothing is built yet.
- **Owners:** the two team members, per [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Deadline:** submission Friday 13 November 2026, 23:59 SAST
- **Sources:** [BUILD-BRIEF.md](../BUILD-BRIEF.md), [PROBLEM.md](PROBLEM.md), [SOLUTION.md](SOLUTION.md), [TRUST.md](TRUST.md), [CFO research](CFO-AGENTIC-FRAUD-SECURITY-RESEARCH-2026-11-10.md), decision records [0001–0005](decisions/README.md)

## 1. Problem

Paying a supplier is the finance step businesses will not automate, because a wrong payment is usually irreversible and the loss usually stays with the payer. Today the only defence is a person re-checking bank details, which makes payment slow. AI that reads invoices adds a new way to be robbed: hidden instructions and forged details. Evidence and its confidence ratings: [PROBLEM.md](PROBLEM.md).

## 2. Product in one line

**The AI proposes. The Warden decides. The ledger proves.** An accounts-payable agent pays routine supplier invoices without a human click, but cannot move money alone: every payment needs a second signature from an independent rules service, enforced by the XRP Ledger.

## 3. Users

| User | Goal | Key needs |
|---|---|---|
| Finance operator (buyer outside South Africa) | Pay suppliers on time without being defrauded | Clear holds with reasons, limits, pause, receipts |
| Approver (second person) | Control risky changes | Approve supplier changes and limit increases |
| South African supplier (first-customer hypothesis) | Get paid sooner; stop fraud in its name | Simple enrolment, signed payout details |
| Auditor | Check any payment after the fact | Exportable trail from document to ledger hash |
| Hackathon judge | Understand and verify quickly | Live payment, visible holds, clickable hashes |

## 4. Goals and non-goals

**Goals for 13 November**
- G1. A real two-signature RLUSD payment on XRPL Testnet, triggered by an invoice with no human click.
- G2. Fraudulent or incomplete invoices held, with plain reasons.
- G3. A human can lower limits and pause, outside the agent's control.
- G4. Every decision traceable to its evidence.
- G5. An honest pitch: what is real, simulated and unverified.

**Non-goals**
- Real money, main network, real bank payouts, real identity or screening services.
- Scanned or handwritten invoices.
- Permission delegation, batch, escrow, wallet vendors (after gates only).
- Legal compliance claims.

## 5. Functional requirements

Priority: **P0** must ship; **P1** should ship; **P2** stretch after Gates A and B.

| ID | Requirement | Priority | Gate |
|---|---|---|---|
| FR-1 | Provision Testnet accounts, RLUSD trust lines and the Agent + Warden signer list from one script | P0 | A |
| FR-2 | Submit a two-signature RLUSD payment and confirm it validated with the expected delivered amount | P0 | A |
| FR-3 | Reject each key alone (recorded) | P0 | A |
| FR-4 | Ingest a text PDF invoice and trigger the workflow without a click | P0 | B/C |
| FR-5 | Extract fields with source quotes into a strict schema; abstain when unclear | P0 | C |
| FR-6 | Match invoice to purchase order and goods-received record | P0 | B |
| FR-7 | Pay only verified, enrolled suppliers; destination from the supplier record | P0 | B |
| FR-8 | Hold on changed payee, missing evidence, duplicate, over-limit, paused | P0 | B |
| FR-9 | Stable obligation identity; one unresolved attempt per payable | P0 | B |
| FR-10 | Per-payment, per-supplier and daily limits; lowering takes effect at once | P0 | B |
| FR-11 | Authenticated pause independent of the console | P0 | B |
| FR-12 | Reliable submission: expiry, persist before submit, reconcile before retry | P0 | A/B |
| FR-13 | Operator console: payment desk, held invoice with reasons, limits, receipt | P0 | D |
| FR-14 | Audit export per payment | P1 | C/D |
| FR-15 | Supplier enrolment and change flow with second-person approval (identity check simulated) | P1 | B |
| FR-16 | Labelled test set and single-prompt baseline comparison | P1 | C |
| FR-17 | Mobile layout for operator limits and receipts | P1 | D |
| FR-18 | Simulated rand payout, clearly labelled | P1 | D |
| FR-19 | Arduino Warden Switch ([ADR 0005](decisions/0005-arduino-operator-hardware.md)) | P2 | after B |
| FR-20 | XRPL credential on supplier accounts ([ADR 0004](decisions/0004-workshop-adjustments.md)) | P2 | after B |

## 6. Non-functional requirements

From [SERVICE-LEVELS.md](SERVICE-LEVELS.md), [COMPLIANCE.md](COMPLIANCE.md) and [RULES.md](RULES.md).

| ID | Requirement |
|---|---|
| NFR-1 | Hard release blockers on the test set: no rule-breaking payment, no duplicate, no false "paid", full traceability |
| NFR-2 | Decision within 60 seconds for a clean invoice (target) |
| NFR-3 | Fail closed on every dependency failure |
| NFR-4 | No secrets or personal data in code, logs, prompts or the ledger |
| NFR-5 | Accessible console: readable labels, not colour alone, keyboard usable, works on a phone |
| NFR-6 | Deployed, reachable demo plus a recorded backup |

## 7. Success measures

| Measure | Target for submission |
|---|---|
| Gate A evidence | Hashes for success and both single-key rejections |
| Attack suite | Every case in [ENGINEERING.md](ENGINEERING.md#attack-suite) run and logged |
| False approvals on the test set | 0, with test-set size stated |
| False holds on legitimate invoices | Measured and reported |
| Customer evidence | At least one consenting finance-lead conversation |
| Unfamiliar user | Can explain a hold, lower a limit and find a receipt |

## 8. Release plan

| Day | Target |
|---|---|
| Tue 10 Nov | Rules, logs, issues agreed; Gate A started |
| Wed 11 Nov | Gate A done; Gate B core holds |
| Thu 12 Nov | Gates C and D; feature freeze; video; submit a valid entry early |
| Fri 13 Nov | Fixes only; final submission before 23:59 SAST |
| Sat 14 Nov | Judging |

## 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| Testnet instability or reset | Two nodes, re-provision script, recorded backup |
| No customer conversation | Pitch commercial fit as a hypothesis |
| Lost payment key freezes the spending balance | Small balance; separate reserve; tested rebuild |
| Scope creep from stretch features | Rule R-21: gates in order |
| Regulatory uncertainty | Qualified wording; no legal claims |

Open: buyer-country rules; whether co-signing makes SignOff regulated; permission-delegation status on Testnet.

## 10. Status at the close of Gate 0 (10 November 2026)

Gate 0 implements none of the functional requirements. It is the foundation they depend on. The non-functional requirements that Gate 0 can already evidence are below.

| Requirement | Status at Gate 0 | Evidence |
|---|---|---|
| NFR-1 Hard release blockers on the test set | Test machinery in place: scans, hooks, guard tests, mutation checks. No payment exists to test yet. | T-021, T-030, T-037 |
| NFR-2 Decision within 60 seconds | Not measured. No decision path exists. | None |
| NFR-3 Fail closed on every dependency failure | Partly: the scanner refuses unexpected git output; money and invoice validation refuse ambiguity. Warden and the ledger are not built. | T-016, T-023, T-024 |
| NFR-4 No secrets or personal data in code, logs, prompts or the ledger | Met for the repository and for logs, tested. Prompts and the ledger are not yet built. | T-013 to T-022; T-033 to T-039 |
| NFR-5 Accessible console | Not started; due in Gate D. | None |
| NFR-6 Deployed, reachable demo | Not started. | None |
