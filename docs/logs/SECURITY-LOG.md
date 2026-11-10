# Security log

Security by design, recorded as we go (rules R-12 to R-15 in [RULES.md](../RULES.md)). Three parts: the threat register (what we defend against and how we check it), the check schedule, and the event log (findings, incidents, changes).

Related: [TRUST.md](../TRUST.md), [SECURITY.md](../../SECURITY.md), [COMPLIANCE.md](../COMPLIANCE.md).

## 1. Threat register

Status: `Open` (no control yet), `Designed` (in documents), `Implemented` (in code), `Verified` (test logged in [TEST-LOG.md](TEST-LOG.md)).

| ID | Threat | Entry point | Control | Verified by | Status |
|---|---|---|---|---|---|
| T-01 | Prompt injection in an invoice | PDF text | Invoice text passed as data; no payment tool for the model; holds on instructions | C3 fixtures | Designed |
| T-02 | Changed bank details (business email compromise) | Invoice, email | Destination only from verified supplier record; changes need supplier key, cooling-off, second approval | F4 (T-025: the proposal schema has no payee field); B3 and B9 tests pending | Partly implemented: F4 removes the payee field from proposals; Warden's verified-record check is pending in B3 |
| T-03 | Malicious file (malware, oversized, disguised type) | Intake folder or inbox | Accept text PDF only by content check, size limit, no macros or embedded files executed, parse in an isolated process, hash and quarantine anything else | C1 tests | Designed |
| T-04 | Malicious links in documents | PDF content | Never fetch links found in documents | C1, C3 tests | Designed |
| T-05 | Stolen agent key | Agent service | Ledger requires Warden too | A4 (T-054) | Verified on Testnet (T-054) |
| T-06 | Stolen Warden key | Warden service | Ledger requires agent too | A4 (T-054) | Verified on Testnet (T-054) |
| T-07 | Both keys stolen | Both services | Loss bounded by small spending balance; abandon and rebuild | A7 (T-057) | Partly verified: rebuild path on Testnet (T-057); the loss bound by balance is not tested |
| T-08 | Seed or key leaked to the repository or logs | Developers, AI tools, logs | Secret scanning, tested pre-commit patterns, log redaction, secret manager | F1 guard test (ignore rules); F3 (scanner, hook, CI scan, deny list; T-013 to T-022); F5 (log redaction; T-033 to T-039) | Implemented for the repository and for logs; provider scanning needs the repository owner (S-005) |
| T-09 | Duplicate or replayed payment | Retries, restarts, concurrency | Stable obligation identity, atomic reservation, reconcile before retry | F4 (T-028); A5 (T-055, T-056); B2 pending | Partly implemented: stable obligation key (F4); reconcile before retry and no blind resubmit on Testnet (T-055, T-056); atomic reservation pending (B2) |
| T-10 | Altered supplier list, purchase order or delivery record | Internal records | Maker-checker, provenance, alerts, fail closed on unapproved changes | B4, B9 | Designed |
| T-11 | Operator account taken over | Console | Strong authentication, second approver for limit increases and suppliers | D3 | Designed |
| T-12 | Injection into our own services (SQL, command, header, cross-site) | API inputs | Strict schemas, parameterised queries, no shell from inputs, cross-site checks, authenticated endpoints | F3 (no shell; argument arrays); F4 (T-024, T-025 strict schemas); B1 pending | Partly implemented: strict schemas and no-shell process use; endpoint and query controls pending in B1 |
| T-13 | Malicious or compromised dependency | npm packages; GitHub Actions | Lockfile and exact pins; 7-day cooldown; logged security-fix override; audit gate in CI; Dependabot with cooldown; actions pinned to commit SHAs | F1 (T-007); F2 (T-009 to T-012) | Implemented; first CI run to be linked |
| T-14 | Ledger state changes between check and sign | Network | Sign exact checked fields; pre-signing read; short expiry | B8, A5 | Designed |
| T-15 | RLUSD frozen or clawed back by issuer | Issuer | Pre-signing read; hold and alert | B8 | Designed |
| T-16 | Personal data sent where it should not go | Model API, ledger, logs | Minimal prompt content; hashes only on ledger; redaction | F5 (T-033 to T-036); C2 pending for prompts | Partly implemented: logs are redacted (F5); prompt boundary pending in C2 |
| T-17 | Forged goods-received scan | RFID (stretch) | Scan is "tag presented"; receiving approval required | S4 | Designed |
| T-18 | Arduino bridge misuse | Operator laptop (stretch) | Short-lived pause/status-only token; no resume, no keys | S1, S3 | Designed |
| T-19 | Secret committed by skipping the hook (`--no-verify`, or hooks not enabled) | Developers | Pre-commit scan; CI scan of tracked files; provider scanning (owner setting) | T-019, T-022 | Implemented; a skipped hook is still caught by CI |
| T-20 | Secret hidden in a binary, encoded or split form | Binary files; encoded or split secrets | Binary files counted in every report; provider scanning; review | T-016 (binary count) | Accepted limitation, documented in SECURITY.md |
| T-21 | Secret or personal data leaked through logs: error text, stacks, hostile fields, event names | Logs | Structural and textual redaction; field-name rule; fail-safe logger; validated event names | T-033 to T-039 | Implemented |
| T-22 | Signed transaction blob read from the local journal | Local journal file | Blobs stay in the local journal and are not passed to the logger. A blob can complete only the payment it was built for (same destination and amount), because both signatures are already in it | T-053 to T-057; reliable-path tests | Implemented (Testnet) |
| T-23 | Testnet seed read from the local registry | Operator machine | Registry outside the repository (a guard refuses repository paths); seeds never printed or logged; master seed removed once its master key is disabled | T-052; T-058; node tests (assertOutsideRepository) | Partly implemented: a separate Warden key store comes in Gate B |
| T-24 | Test-issued token mistaken for RLUSD | Test log, README, command output | The test log and README name the test-issued token on every live row; the RLUSD run is recorded separately as BLOCKED; provisioning output names each trust line token | T-051; T-053; T-059 | Partly implemented: payment output does not name the token (S-020); console labelling pending Gate D |
| T-25 | Payment on the wrong network or endpoint | Endpoint configuration, failover | Allow-list of two Testnet endpoints; wss only; no credentials; network ID checked on connect; other endpoints refused; unavailable endpoints logged | Connection and network tests; T-056 | Implemented |
| T-26 | Double payment after a retry | Retries, restarts, lost responses | Paid only on a validated success; a settled payment id is never sent again; an unresolved attempt is resumed with its stored blob; a new attempt only after expiry past the safety margin, numbered from the journal; stored terms must match the request | T-055; T-056; T-065; T-067 | Implemented (Testnet); review fixes verified by T-065 and T-067; obligation-level idempotency pending (B2) |

## 2. Check schedule

| Check | When | Tool or method |
|---|---|---|
| Secret scan | Every push and pre-commit | GitHub secret scanning; pre-commit pattern check |
| Dependency audit | Every pull request | `npm audit` in CI; Dependabot |
| Type and schema checks | Every pull request | TypeScript strict; Zod |
| Prompt-injection fixtures | Every change to prompts, extraction or intake | C3 test set |
| Malicious-file fixtures | Every change to intake | C1 tests: wrong type, oversized, embedded content |
| Attack suite | Before each phase close and each demo | Logged in TEST-LOG |
| Manual review of security-relevant pull requests | Each such pull request | Second team member, citing threat IDs |
| Log redaction test | Every pull request | F5 test |

## 3. Event log

Findings, incidents and security-relevant changes. Newest at the bottom.

| ID | Date | Type | Description | Threat IDs | Action | Status |
|---|---|---|---|---|---|---|
| S-001 | 2026-11-10 | Design review | Recovery key with Warden could pay without the agent | T-05, T-06 | Recovery signer removed (D-006) | Closed in design |
| S-002 | 2026-11-10 | Design review | Naive "starts with s" seed check would give false positives | T-08 | Tested XRPL patterns required (F3) | Closed in design |
| S-003 | 2026-11-10 | Design review | Trust line limit wrongly described as a loss cap | T-07 | Wording corrected (D-005) | Closed in design |
| S-004 | 2026-11-10 | Dependency | npm audit reported 10 moderate advisories, all through minimatch (GHSA-g3hv-75wg-m249, ReDoS). npm's suggested fix downgrades ESLint to 9. | T-13 | minimatch overridden to 11.0.5; audit now reports 0; ESLint kept at 10 (D-014) | Closed |
| S-005 | 2026-11-10 | Governance gap | Branch protection that requires checks before merge, and GitHub secret scanning with push protection, are repository settings. The current account has write access but not admin rights. | T-08, T-13 | Requested from the repository owner in the pull request. The F2 workflow supplies the checks to require. | Open: owner action |
| S-006 | 2026-11-10 | Design review | CI runs on public pull requests execute code from forks. Mitigated by a read-only token, no secrets and no `pull_request_target` (D-018). | T-08, T-13 | Control accepted; revisit when secrets are added | Closed in design |
| S-007 | 2026-11-10 | Finding | The pre-commit check refused a commit containing a literal password in a test sample. The sample is now assembled at run time, as every other sample secret is. | T-08 | Fixed in F3 | Closed |
| S-008 | 2026-11-10 | Dependency | npm 11 held back the install script of esbuild, a dependency of tsx. The scanner works without it, and the script is not approved (D-024). | T-08, T-13 | Recorded | Closed |
| S-009 | 2026-11-10 | Design finding | The first draft exported Node-only security code from the platform-neutral entry point, which would have blocked browser code from importing the schemas. Split into '.' (neutral) and './node' (Node-only), with a test that enforces the split. | T-12 | Fixed in F4 (D-025) | Closed |
| S-010 | 2026-11-10 | Finding (test) | A test showed that invoice numbers differing only in spacing or punctuation produced different obligation keys, so a duplicate written that way could pass as a new payable. Fixed by reducing the number to letters and digits (D-026). | T-09 | Fixed in F4 | Closed |
| S-011 | 2026-11-10 | Change | F5 adds structural and textual redaction and a fail-safe logger. Verified by T-033 to T-039, including a mutation test (T-036). | T-16, T-21 | Recorded | Closed |
| S-012 | 2026-11-10 | Review finding | F5 error fallback wrote unredacted `options.service` when the first sink write failed. Sensitive email or seed-like data in service names could leak despite the main redactor. | T-08, T-21 | Replaced fallback service with a fixed safe literal and added an explicit failing-sink regression (T-040). | Closed; CI #42835936809 passes |
| S-013 | 2026-11-10 | Review finding | Object property *names* could contain sensitive data, but F5 initially redacted only their values. | T-16, T-21 | Sanitize every output field name with redaction and length limit; test generated seed and fictional email used as keys (T-041). | Closed; CI #42835936809 passes |
| S-016 | 2026-11-10 | Design review | A signed transaction is stored in the local journal before it is submitted, so a crash or a lost response is reconciled by its hash. Such a blob can complete only the payment it was built for. | T-22, T-26 | Built and tested on Testnet (T-055, T-056) | Closed |
| S-017 | 2026-11-10 | Finding | Testnet seeds are held in the local registry, outside the repository, and are not printed or logged. The spending master seed is removed after its master key is disabled. Protection rests on the operating-system user profile; no separate key store exists yet. | T-23 | Recorded; a separate Warden key store comes in Gate B | Open: Gate B |
| S-018 | 2026-11-10 | Finding | The log redactor replaced a currency label logged under the field name token with [REDACTED:field]. No secret was exposed. The field is now named currency. | T-21 | Field renamed; provisioning run T-051 predates the rename | Closed |
| S-019 | 2026-11-10 | Finding | During the first provisioning run the primary Testnet endpoint did not answer, and the command connected to the secondary. The failure was not logged at the time, so its cause is unknown. Unavailable endpoints are now logged with their error. | T-25 | Logging added; cause not determined | Open |
| S-020 | 2026-11-10 | Change | Live payments use a test-issued token (TST), not RLUSD. Testnet RLUSD is available only through a faucet that requires a sign-in, which the assistant does not perform. The payment outputs do not print the token code. | T-24 | Test-issued token used; RLUSD run recorded as BLOCKED (T-059) | Open |
| S-021 | 2026-11-10 | Finding | The pre-commit check refused the first Gate A commit: a test file held a complete, checksum-valid XRPL family seed as a literal. The literal is now generated at run time, as every other test sample secret is (S-007). No seed was committed or pushed. | T-08, T-19 | Fixed on the Gate A branch; the hook rescans the staged files at commit | Closed |
| S-022 | 2026-11-10 | Finding | Review before merge found that a repeated run of a proof command could submit a second payment, because the journal was not read before a send. A reused payment id with other terms could also be resent. The reconciliation could declare expiry from a lookup that ran before a later validated ledger. No second payment occurred: each payment id has one paid record (T-067). | T-22, T-26 | Fixed: the journal decides before every send; an unresolved attempt is resumed by its stored blob; expiry needs the safety margin and reads the validated index first (D-046, D-047); regression tests T-065; live re-runs refused T-067 | Closed |
| S-023 | 2026-11-10 | Finding | The rebuild command abandons the working spending account on every run, and it had no confirmation step. | T-07 | Requires --confirm; refused without it (T-067) | Closed |

**Types:** `Design review`, `Finding`, `Incident`, `Dependency`, `Key rotation`, `Change`. An incident involving a real key or personal data also follows [SECURITY.md](../../SECURITY.md).
