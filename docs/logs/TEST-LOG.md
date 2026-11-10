# Test log

Continuous record of test runs that count as evidence (rule R-20 in [RULES.md](../RULES.md)). CI runs every unit test on every pull request; this log records the runs that move a claim, close an issue or close a gate. Newest at the bottom.

**A test without an entry here has not passed** for the purpose of the README status table.

## What gets logged

| Kind | When | Required fields |
|---|---|---|
| Ledger test | Every Testnet run in Gates A and B | Result code, transaction hash, network, explorer link |
| Attack suite | Every full run | Each case: expected, actual, pass/fail |
| Evaluation | Every run on the labelled test set | Set size and version, false approvals, false holds, field accuracy, model and prompt version |
| End-to-end | Before each demo and after each deployment | Flow, steps, result, video or screenshot reference |
| Regression | When a previously passing test fails | What broke, cause, fix pull request |

## Entry format

| ID | Date and time (SAST) | Issue | Test | Commit | Policy version | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|---|---|---|---|

- **Result:** `PASS`, `FAIL`, `BLOCKED` (could not run) or `SIMULATED` (fixture mode; does not count for live claims).
- **Evidence:** hash, explorer link, CI run link, or file in the repository. Never seeds, keys or personal data.

## Standing test plan

Every row must have at least one `PASS` entry before its gate closes.

| Gate | Tests |
|---|---|
| A | Two-signature payment validates; Agent alone rejected; Warden alone rejected; timeout then reconcile; node failover keeps identity; rebuild from reserve |
| B | Changed payee held; missing goods receipt held; duplicate held; concurrent requests: one proceeds; over-limit held; lowered limit applies next; pause with console stopped; non-payment transaction refused; frozen trust line held |
| C | Hidden-instruction invoice held; missing-field invoice held; forged quote rejected; evaluation run with baseline |
| D | Unfamiliar user explains a hold, lowers a limit, finds a receipt; never "paid" before validation; phone-width check |
| Stretch | ADR 0005 acceptance matrix; credential issue, accept, check, delete |

## Entries

| ID | Date and time (SAST) | Issue | Test | Commit | Policy version | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| — | — | — | No tests run yet. No code exists. | — | — | — | — | — | — |
