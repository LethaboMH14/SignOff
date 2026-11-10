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
| T-001 | 2026-11-10 15:51 | F1 | `npm run format:check` | b07b352 | n/a | exit 0 | exit 0 | PASS | local; repeated in the clean clone (T-008) |
| T-002 | 2026-11-10 | F1 | `npm run lint` with max warnings 0 | b07b352 | n/a | exit 0 | exit 0 after fixing 2 warnings in the guard test | PASS | local; one justified line-level exception, documented in the file |
| T-003 | 2026-11-10 | F1 | `npm run typecheck` with every strict flag | b07b352 | n/a | exit 0 | exit 0 | PASS | local; repeated in the clean clone (T-008) |
| T-004 | 2026-11-10 15:51 | F1 | `npm run test:coverage` | b07b352 | n/a | 6 tests pass; thresholds met | 6 of 6 pass; 100% of 1 statement | PASS | local; CI evidence to be linked after F2 |
| T-005 | 2026-11-10 | F1 | Mutation check: `noUnusedLocals` set to false, then restored | b07b352 | n/a | guard test fails, then passes | failed with the flag named; passed after restore | PASS | local; proves the guard detects a weakened setting |
| T-006 | 2026-11-10 | F1 | `npm run build` | b07b352 | n/a | dist emitted | `index.js` and `index.d.ts` emitted | PASS | local; repeated in the clean clone (T-008) |
| T-007 | 2026-11-10 | F1 | `npm audit` before and after the minimatch override | b07b352 | n/a | no high or critical findings | before: 10 moderate; after: 0 | PASS | local; resolved as S-004 |
| T-008 | 2026-11-10 | F1 | Clean clone of the committed branch: `npm ci`, then `npm run check` | b07b352 | n/a | install and every check pass | install exit 0; check exit 0; 6 tests pass | PASS | clone of the local commit into an empty folder |
