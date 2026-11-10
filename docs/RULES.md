# Ruleset: the contract every change must meet

Agreed before any code is written. Applies to every commit, pull request, document, test, demo and pitch claim. Where another document disagrees, this file and [BUILD-BRIEF.md](../BUILD-BRIEF.md) win; propose a change through a decision record.

Rules are numbered so reviews and logs can cite them ("breaks R-12").

## 1. Truth and evidence

- **R-1. Every claim has a state.** One of: *Planned*, *Live on Testnet*, *Simulated*, *Validated with customers*. The README status table is the single source; a pull request that changes a state updates it.
- **R-2. A state changes only with evidence.** Live needs a transaction hash or recorded test run. Validated needs a consenting interview or written statement. See [ENGINEERING.md](ENGINEERING.md#evidence-for-each-test).
- **R-3. Simulated means labelled.** Anything not real is marked "simulated" in the console, the README, the logs and the video.
- **R-4. Sources or "unverified".** Every factual claim links a source or is marked unverified. Secondhand figures follow the ratings in [PROBLEM.md](PROBLEM.md).
- **R-5. No guarantees from tests.** Zero failures on a test set is reported with the test set's size and scope, never as "zero risk".

## 2. Money and ledger

- **R-6. The model proposes; it never decides or signs.** Only Warden's fixed rules authorise; only Agent + Warden signatures move funds ([TRUST.md](TRUST.md)).
- **R-7. Destinations never come from documents.** Payee accounts come only from verified supplier records.
- **R-8. Fail closed.** Any missing dependency, unreadable record or unclear result is a hold, never a payment.
- **R-9. "Paid" means validated.** Only a validated ledger transaction with the expected delivered amount is shown as paid.
- **R-10. One payable, one identity.** The stable obligation identity never changes with amount, document or retry ([ENGINEERING.md](ENGINEERING.md#payment-state-machine)).
- **R-11. Testnet only.** No main-network keys, no real funds, no real personal data in this repository.

## 3. Security

- **R-12. No secrets anywhere public.** No seeds, keys, tokens, account identifiers or personal data in code, commits, logs, issues, prompts, ledger memos or recordings.
- **R-13. All external content is hostile.** Invoices, emails, web pages, scanner input and model output are untrusted data, never instructions.
- **R-14. Least privilege.** Each service and device gets only the permissions its job needs; the agent never sees Warden's key; the Arduino bridge can only pause and read status.
- **R-15. Every security-relevant change is logged** in [logs/SECURITY-LOG.md](logs/SECURITY-LOG.md).

## 4. Process

- **R-16. Work starts from an issue** in [ISSUES.md](ISSUES.md). No issue, no branch.
- **R-17. Small pull requests, reviewed by the other team member,** merged with a merge commit. Nobody merges their own unreviewed work.
- **R-18. Direction changes need a decision record** in [decisions/](decisions/), using [the template](decisions/TEMPLATE.md), marked Proposed until accepted.
- **R-19. Every working session adds a build-log entry** to [logs/BUILD-LOG.md](logs/BUILD-LOG.md). Smaller choices go in [logs/DECISION-JOURNAL.md](logs/DECISION-JOURNAL.md).
- **R-20. Every test run that counts is logged** in [logs/TEST-LOG.md](logs/TEST-LOG.md).
- **R-21. Gates in order.** Work on a later gate does not merge while an earlier gate is failing ([ENGINEERING.md](ENGINEERING.md#delivery-gates)). Stretch work waits for Gates A and B.
- **R-22. AI-assisted commits carry a co-author trailer.** AI tools never receive secrets or real personal data.
- **R-23. Every document is brought up to date at the end of each phase.** A gate is not closed until the phase-close checklist below is done and a phase-close entry is in [logs/BUILD-LOG.md](logs/BUILD-LOG.md).

### Phase-close checklist (rule R-23)

At the end of every gate (0, A, B, C, D, E, stretch), one pull request titled `Phase close: Gate <X>` reviews and updates each of these, or states "no change" for it:

| Document | What to update |
|---|---|
| [README.md](../README.md) | Status table rows, status banner, honest limits |
| [BUILD-BRIEF.md](../BUILD-BRIEF.md) | Any change in flow, stack or acceptance |
| [PRD.md](PRD.md) | Requirement status, goals met, risks |
| [ISSUES.md](ISSUES.md) | Status of every issue in the gate; new issues found; cuts |
| [ENGINEERING.md](ENGINEERING.md) | Layout, tests, gates as actually built |
| [TRUST.md](TRUST.md) and [SOLUTION.md](SOLUTION.md) | Guarantees now proven or changed |
| [SERVICE-LEVELS.md](SERVICE-LEVELS.md) | Measured values replacing targets |
| [AGENT-RELIABILITY.md](AGENT-RELIABILITY.md) | Evaluation results |
| [COMPLIANCE.md](COMPLIANCE.md) | Anything now real rather than simulated |
| [HACKATHON.md](HACKATHON.md) | Scoring standing, deadlines |
| [decisions/](decisions/) | Status of affected records |
| [logs/](logs/) | Build-log phase close, journal entries, test-log entries, security threat statuses |

Documents not listed (research, workshop notes, problem, business) are updated when their facts change, not every phase.

## 5. Definition of done (for an issue)

An issue is done only when all apply:

1. Its acceptance criteria in [ISSUES.md](ISSUES.md) are met.
2. Tests exist for the passing case and the failing case, and pass in CI.
3. Evidence is recorded in the test log, with hashes where the ledger is involved.
4. Security checks in the pull request template are ticked; anything new is in the security log.
5. Affected documents and the README status table are updated.
6. The other team member has reviewed and merged it.

## 6. Changing these rules

This applies to rule R-23 too.


Open a pull request that edits this file and adds a decision-journal entry. Both team members must approve.
