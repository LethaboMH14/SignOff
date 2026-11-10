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
| T-009 | 2026-11-10 | F2 | Structure of `ci.yml` and `dependabot.yml`: both parse; triggers are pull_request and push; permissions are read-only; concurrency is set; two jobs; every action is pinned to a 40-character SHA | dde630e | n/a | valid | valid | PASS | YAML parse in the session; repeated by reading the files |
| T-010 | 2026-11-10 | F2 | Every input the workflow uses exists in `action.yml` at the pinned commits (checkout: `persist-credentials`; setup-node: `node-version-file`, `cache`) | dde630e | n/a | present | present | PASS | `gh api` reads of both `action.yml` files at the pinned SHAs |
| T-011 | 2026-11-10 | F2 | Dependabot schema accepts `cooldown` with `default-days` | dde630e | n/a | valid | valid | PASS | SchemaStore schema read through the GitHub API |
| T-012 | 2026-11-10 | F2 | Clean clone of the committed branch: `npm ci`, `npm run check`, `npm audit --audit-level=high` | dde630e | n/a | every step exits 0 | exit 0; 6 tests pass; 0 vulnerabilities | PASS | clone of the local commit into an empty folder |
| T-013 | 2026-11-10 | F3 | Base58: 58 distinct characters, none of 0, O, I, l; account-zero address decodes to 25 bytes with a verifying checksum; leading zeros map to r; round trip; non-alphabet input rejected | 0527436 | n/a | all pass | 8 of 8 pass | PASS | `packages/shared/test/security/base58.test.ts`; part of the 78-test run (T-021) |
| T-014 | 2026-11-10 | F3 | Seed detector: checksum-valid secp256k1 and ed25519 forms accepted; a form with an unlisted prefix accepted; one changed character, a wrong decoded size, an address, non-base58 text, the empty string and a bare s all rejected | 0527436 | n/a | all pass | 8 of 8 pass | PASS | `packages/shared/test/security/xrpl-seed.test.ts` |
| T-015 | 2026-11-10 | F3 | Pattern detector: each of the eight kinds found; 64-character hashes, public addresses, corrupted seeds, environment placeholders, prose and invoice numbers not reported; line and column correct; values never returned | 0527436 | n/a | all pass | 19 of 19 pass | PASS | `packages/shared/test/security/secret-patterns.test.ts` |
| T-016 | 2026-11-10 | F3 | Scanner: judges the staged content, not the working copy; a secret staged then removed from the working copy is still caught; denied file names; .env.example allowed; binary files counted; fails closed outside git; --all reads the index; argument rules; malformed git output fails | 0527436 | n/a | all pass | 35 of 35 pass | PASS | `scripts/test/secret-scan.test.ts` |
| T-017 | 2026-11-10 | F3 | Hook installer: sets core.hooksPath in a git checkout for that clone only; does nothing outside a checkout and still exits 0 | 0527436 | n/a | all pass | 2 of 2 pass | PASS | `scripts/test/setup-hooks.test.ts` |
| T-018 | 2026-11-10 | F3 | Mutation: the seed checksum check forced to always pass, then restored | ebb3b0d (working tree of the F3 branch) | n/a | the seed tests fail | 2 failed (both corrupted-seed cases); restored file identical to the original; 35 of 35 pass again | PASS | proves the tests catch a broken checksum |
| T-019 | 2026-11-10 | F3 | Real commit path: a throwaway seed generated at run time, staged, and `git commit` run | ebb3b0d (HEAD at the time) | n/a | commit refused; HEAD unchanged | refused with exit 1; reported `scripts/hook-probe.ts:1:23: xrpl-family-seed`; no value printed; HEAD unchanged | PASS | probe file deleted and unstaged; the seed is not recorded anywhere. A second attempt was refused for a literal password in a test sample (S-007) |
| T-020 | 2026-11-10 | F3 | Real commit path: the F3 commit passes the same hook | 0527436 | n/a | commit accepted | accepted; staged scan of 21 files, 0 issues | PASS | `git log` shows 0527436 on `feat/F3-secret-protection` |
| T-021 | 2026-11-10 | F3 | `npm run check` on the F3 tree: format, lint, types, secret scan of every tracked file, 78 tests, coverage, build | 0527436 | n/a | exit 0 | exit 0; scan 75 files, 0 issues; 78 of 78 pass; statements 97.02%, branches 88.23%, functions 100%, lines 98.67% | PASS | local; thresholds are 90, 85, 90, 90 |
| T-022 | 2026-11-10 | F3 | Clean clone of `feat/F3-secret-protection`: `npm ci`; hooks enabled by the install alone; `npm run check`; `npm audit --audit-level=high`; a seed commit in the clone is refused | 0527436 | n/a | every step exits 0; the seed commit exits 1 | ci exit 0 and hooksPath set to `.githooks`; check exit 0; audit exit 0 with 0 vulnerabilities; seed commit exit 1 | PASS | clone of the local commit into an empty folder |
