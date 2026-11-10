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
| T-023 | 2026-11-10 | F4 | Money parser: 9 accepted forms; 15 rejected forms, each with a reason; over-maximum amount; formatting for people; decimal strings; round trips; integer guard; two decimal places for every currency | 1b353d9 | n/a | all pass | 35 of 35 pass | PASS | `packages/shared/test/money/minor-units.test.ts` |
| T-024 | 2026-11-10 | F4 | Invoice extraction: complete extraction accepted; explicit nulls accepted; injected payee key, numeric amount, value without its quote, quote over 500 characters, unlisted currency and non-ISO date rejected; validation returns the exact total or names the missing fields | 1b353d9 | n/a | all pass | 12 of 12 pass | PASS | `packages/shared/test/schemas/invoice.test.ts` |
| T-025 | 2026-11-10 | F4 | Payment proposal: accepted when it names a supplier and an amount; rejected with any of four payee-field names, a zero, negative, fractional or over-maximum amount, a non-agent proposer, malformed identifiers, or a timestamp with an offset | 1b353d9 | n/a | all pass | 12 of 12 pass | PASS | `packages/shared/test/schemas/proposal.test.ts` |
| T-026 | 2026-11-10 | F4 | Warden decision: ALLOW only with no reasons; HOLD and REFUSE only with at least one reason; unknown reason code, unknown decision and empty message rejected | 1b353d9 | n/a | all pass | 7 of 7 pass | PASS | `packages/shared/test/schemas/warden-decision.test.ts` |
| T-027 | 2026-11-10 | F4 | Obligation: open obligation accepted; remaining amount computed; reservations plus settlements may not exceed the approved amount; settled and cancelled rules enforced; zero or negative approval rejected | 1b353d9 | n/a | all pass | 7 of 7 pass | PASS | `packages/shared/test/schemas/obligation.test.ts` |
| T-028 | 2026-11-10 | F4 | Obligation key: known-answer digest; 64 lower-case hex; case, spacing, punctuation and full-width variants give one key; leading zeros and suppliers separate keys; separator characters cannot collide; amount is not an input | 1b353d9 | n/a | all pass | 11 of 11 pass | PASS | known-answer digest computed with `sha256sum` over `[1,"SUP-ABC123","INV001"]`; `packages/shared/test/obligation-key.test.ts` |
| T-029 | 2026-11-10 | F4 | Entry points: the platform-neutral entry exposes money and schemas and not the security helpers; its money and schema modules contain no Node built-in imports; the Node entry exposes the security helpers | 1b353d9 | n/a | all pass | 3 of 3 pass | PASS | `packages/shared/test/entry-points.test.ts` |
| T-030 | 2026-11-10 | F4 | `npm run check` on the F4 tree: format, lint, types, secret scan of tracked files, 165 tests, coverage, build | 1b353d9 | n/a | exit 0 | exit 0; scan 75 files, 0 issues; 165 of 165 pass; statements 96.36%, branches 89.57%, functions 100%, lines 98.78% | PASS | local; thresholds are 90, 85, 90, 90 |
| T-031 | 2026-11-10 | F4 | Real commit path: the F4 commit passes the pre-commit hook | 1b353d9 | n/a | commit accepted | accepted; staged scan of 19 files, 0 issues | PASS | `git log` shows 1b353d9 on `feat/F4-shared-schemas` |
| T-032 | 2026-11-10 | F4 | Clean clone of `feat/F4-shared-schemas`: `npm ci` enables the hooks; `npm run check`; `npm audit --audit-level=high`; the platform-neutral build references no Node built-ins | 1b353d9 | n/a | every step exits 0; zero Node imports in the neutral build | ci exit 0 with hooksPath `.githooks`; check exit 0 with 165 passing and a scan of 92 files, 0 issues; audit exit 0 with 0 vulnerabilities; 0 neutral files import `node:` | PASS | clone of the local commit into an empty folder |
| T-033 | 2026-11-10 | F5 | Personal identifiers: email, IBAN, phone, national ID (date range and Luhn), payment card (Luhn), checked against an independent Luhn reference; a wrong check digit is not an ID; amounts, invoice numbers and lower-case hashes are not reported | 7031e35 | n/a | all pass | 9 of 9 pass | PASS | `packages/shared/test/logging/pii.test.ts` |
| T-034 | 2026-11-10 | F5 | Redaction: a seed, PEM blocks (with their body, and unterminated), a GitHub token, a password, an email and an IBAN are removed from text; hashes, obligation keys, amounts and invoice numbers stay readable; sensitive field names are redacted whatever the value; nested walks; input not modified; cycles, depth, width and length limits; unsupported types; error text and stack; a throwing getter; a `__proto__` key stays data | 7031e35 | n/a | all pass | 14 of 14 pass | PASS | `packages/shared/test/logging/redact.test.ts` |
| T-035 | 2026-11-10 | F5 | Logger: one JSON line with time, level, service and event; reserved keys win; minimum level; a secret in a field, a message or the service name never reaches the sink; an invalid event name is replaced and not echoed; cycles; a throwing getter; a failing sink does not throw; event-name rules | 7031e35 | n/a | all pass | 21 of 21 pass | PASS | `packages/shared/test/logging/logger.test.ts` |
| T-036 | 2026-11-10 | F5 | Mutation: the field-name rule disabled, then restored | 7031e35 (working tree) | n/a | the redaction tests fail | 3 failed; original restored byte for byte; 44 of 44 pass again | PASS | proves the tests catch disabled redaction |
| T-037 | 2026-11-10 | F5 | `npm run check` on the F5 tree: format, lint, types, secret scan of tracked files, 209 tests, coverage, build | 7031e35 | n/a | exit 0 | exit 0; scan 92 files, 0 issues; 209 of 209 pass; statements 96.09%, branches 89.35%, functions 96.61%, lines 98.61% | PASS | local; thresholds are 90, 85, 90, 90 |
| T-038 | 2026-11-10 | F5 | Real commit path: the F5 commit passes the pre-commit hook | 7031e35 | n/a | commit accepted | accepted; staged scan of 8 files, 0 issues | PASS | `git log` shows 7031e35 on `feat/F5-log-redaction` |
| T-039 | 2026-11-10 | F5 | Clean clone of `feat/F5-log-redaction`: `npm ci` enables the hooks; `npm run check`; `npm audit --audit-level=high`; the platform-neutral build references no Node built-ins | 7031e35 | n/a | every step exits 0; zero Node imports in the neutral build | ci exit 0 with hooksPath `.githooks`; check exit 0 with 209 passing and a scan of 99 files, 0 issues; audit exit 0 with 0 vulnerabilities; 0 neutral files import `node:` | PASS | clone of the local commit into an empty folder |
| T-040 | 2026-11-10 | F5 | Regression: when the normal sink write fails, a fallback record may not contain the configured service's email or generated throwaway XRPL family seed | 0eba60f | n/a | no secret or personal data emitted; fallback remains non-throwing | PASS: fallback service is a fixed safe identifier; asserted in logger.test.ts and current GitHub CI | PASS | [CI run #42835936809](https://github.com/LethaboMH14/SignOff/actions/runs/42835936809) |
| T-041 | 2026-11-10 | F5 | Regression: redact secrets and emails appearing in untrusted JSON property *names*, not only values | 0eba60f | n/a | no raw sensitive field name in serialized record | PASS: names are sanitized by redactText; asserted in redact.test.ts and current GitHub CI | PASS | [CI run #42835936809](https://github.com/LethaboMH14/SignOff/actions/runs/42835936809) |
| T-042 | 2026-11-10 | F5 | GitHub Actions for updated F5 head: exact install, format, lint, types, secret scan, coverage, build and high/critical dependency audit | 0eba60f | n/a | both CI jobs succeed | Both jobs completed successfully | PASS | [CI run #42835936809](https://github.com/LethaboMH14/SignOff/actions/runs/42835936809) |
