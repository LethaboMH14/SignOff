# Security log

Security by design, recorded as we go (rules R-12 to R-15 in [RULES.md](../RULES.md)). Three parts: the threat register (what we defend against and how we check it), the check schedule, and the event log (findings, incidents, changes).

Related: [TRUST.md](../TRUST.md), [SECURITY.md](../../SECURITY.md), [COMPLIANCE.md](../COMPLIANCE.md).

## 1. Threat register

Status: `Open` (no control yet), `Designed` (in documents), `Implemented` (in code), `Verified` (test logged in [TEST-LOG.md](TEST-LOG.md)).

| ID | Threat | Entry point | Control | Verified by | Status |
|---|---|---|---|---|---|
| T-01 | Prompt injection in an invoice | PDF text | Invoice text passed as data; no payment tool for the model; holds on instructions | C3 fixtures | Designed |
| T-02 | Changed bank details (business email compromise) | Invoice, email | Destination only from verified supplier record; changes need supplier key, cooling-off, second approval | B3, B9 tests | Designed |
| T-03 | Malicious file (malware, oversized, disguised type) | Intake folder or inbox | Accept text PDF only by content check, size limit, no macros or embedded files executed, parse in an isolated process, hash and quarantine anything else | C1 tests | Designed |
| T-04 | Malicious links in documents | PDF content | Never fetch links found in documents | C1, C3 tests | Designed |
| T-05 | Stolen agent key | Agent service | Ledger requires Warden too | A4 | Designed |
| T-06 | Stolen Warden key | Warden service | Ledger requires agent too | A4 | Designed |
| T-07 | Both keys stolen | Both services | Loss bounded by small spending balance; abandon and rebuild | A7 | Designed |
| T-08 | Seed or key leaked to the repository or logs | Developers, AI tools, logs | Secret scanning, tested pre-commit patterns, log redaction, secret manager | F1 guard test (ignore rules); F3 (scanner); F5 (redaction) | Partly implemented: ignore rules in F1; scanner and redaction pending |
| T-09 | Duplicate or replayed payment | Retries, restarts, concurrency | Stable obligation identity, atomic reservation, reconcile before retry | B2, A5 | Designed |
| T-10 | Altered supplier list, purchase order or delivery record | Internal records | Maker-checker, provenance, alerts, fail closed on unapproved changes | B4, B9 | Designed |
| T-11 | Operator account taken over | Console | Strong authentication, second approver for limit increases and suppliers | D3 | Designed |
| T-12 | Injection into our own services (SQL, command, header, cross-site) | API inputs | Strict schemas, parameterised queries, no shell from inputs, cross-site checks, authenticated endpoints | B1 tests | Designed |
| T-13 | Malicious or compromised dependency | npm packages | Lockfile and exact pins, 7-day cooldown, logged security-fix override, audit in CI, Dependabot | F1 (pins, override, audit results in T-007); F2 (CI audit, Dependabot) | Partly implemented: pins, override and cooldown in F1; CI audit and Dependabot in F2 |
| T-14 | Ledger state changes between check and sign | Network | Sign exact checked fields; pre-signing read; short expiry | B8, A5 | Designed |
| T-15 | RLUSD frozen or clawed back by issuer | Issuer | Pre-signing read; hold and alert | B8 | Designed |
| T-16 | Personal data sent where it should not go | Model API, ledger, logs | Minimal prompt content; hashes only on ledger; redaction | F5, C2 | Designed |
| T-17 | Forged goods-received scan | RFID (stretch) | Scan is "tag presented"; receiving approval required | S4 | Designed |
| T-18 | Arduino bridge misuse | Operator laptop (stretch) | Short-lived pause/status-only token; no resume, no keys | S1, S3 | Designed |

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

**Types:** `Design review`, `Finding`, `Incident`, `Dependency`, `Key rotation`, `Change`. An incident involving a real key or personal data also follows [SECURITY.md](../../SECURITY.md).
