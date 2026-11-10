# Phase reports

One report at the close of every gate (rule R-24 in [RULES.md](../RULES.md)), newest first. Each report is also given to the user in the session that closes the gate. A gate is closed when its pull requests are merged, not when the work is built (D-038).

## Template

```
## Gate <X>: <name>, <date> (SAST)

**Status:** <built / merged / blocked>, with each pull request and its state.

### Delivered
| Issue | What | Pull request | Commit | Evidence |

### Numbers
Tests (count and files), coverage, scans, audits, mutation tests, CI runs.

### What went wrong and what changed
Each defect: how it was found, how it was fixed, and the record that shows it.

### Documents updated (R-23)
Each document: changed, or "no change" and why.

### Decisions and threats changed
IDs from the decision journal and the security log.

### Not done, and carried forward
Owner actions, deferred items, risks.

### Next gate
The first step, and the decision needed from the user before it starts.
```

---

## Gate 0: foundation, 10 November 2026 (SAST)

**Status:** Built and tested. GitHub CI passed for F2, F3, F4 and F5 (four runs, every job successful). Five pull requests are open and stacked: #12 (F1), #13 (F2), #14 (F3), #15 (F4) and #16 (F5), each based on the one before it; #12 is based on #6. Pull requests #5 and #6 are open against main. None has a review decision yet. The phase-close pull request, "Phase close: Gate 0", is based on #16. Gate 0 closes when its pull requests merge (D-038), and two of its acceptance points need the repository owner (see below).

This report was checked against git, GitHub and the logs before the phase-close commit. The full check was re-run on the phase-close tree (T-044).

### Delivered

| Issue | What | Pull request (head) | Feature commit | Evidence |
|---|---|---|---|---|
| F1 #7 | npm workspaces; strict TypeScript 6.0.3; Node 24 pinned; one install command; ESLint 10 with security rules; Prettier; Vitest 5.1.0 with coverage thresholds; guard tests | #12 (5bc736b) | b07b352 | T-001 to T-008 |
| F2 #8 | CI on every pull request: a check job (format, lint, types, tests, secret scan, build) and an audit job (`npm audit --audit-level=high`); actions pinned to commit SHAs; read-only token; Dependabot with a 7-day cooldown | #13 (ebb3b0d) | dde630e | T-009 to T-012; CI run 42829529654 (T-040) |
| F3 #9 | Checksum-verified XRPL seed detection; secret patterns that report kind and position, never the value; scanner for staged content; pre-commit hook; CI scan; hook enabled by the install | #14 (fea620b) | 0527436 | T-013 to T-022; CI run 42831445900 (T-041) |
| F4 #10 | Integer minor-unit money with a strict invoice-text parser; Zod schemas for invoice extraction, payment proposal, Warden decision and obligation; stable obligation key; platform-neutral and Node-only entry points | #15 (555ad46) | 1b353d9 | T-023 to T-032; CI run 42832703291 (T-042) |
| F5 #11 | Log redaction in text and in structure; personal-identifier detection with check digits; fail-safe logger | #16 (a90c552) | 7031e35 | T-033 to T-039; CI run 42833682423 (T-043) |

After 7031e35, the F5 branch adds only log documents (commit a90c552 changes five log files), so the code tested is the same.

### Acceptance (ISSUES.md)

| Issue | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| F1 | Monorepo layout; TypeScript strict; Node 24; one command to install | Met | T-001 to T-008 |
| F2 | Type check, lint, unit tests and build run on every pull request | Met | T-009 to T-012; T-040 |
| F2 | Must pass to merge | **Not yet.** Needs the required-checks setting, which the repository owner must set (S-005) | S-005 |
| F3 | Pre-commit check with tested XRPL seed patterns, with true and false positive tests | Met | T-013 to T-019 |
| F3 | `.env` ignored | Met | F1 guard tests (T-004) |
| F3 | GitHub secret scanning on | **Not yet.** Owner setting (S-005) | S-005 |
| F4 | Zod schemas for invoice extraction, payment proposal, Warden decision and obligation; integer minor units | Met | T-023 to T-032 |
| F5 | Logger removes seeds, keys, bank details and personal data; a test proves it | Met | T-033 to T-039 |

### Numbers

- **Tests:** 209 passed in 17 test files at the phase close (T-044). By gate: 6 (F1), 78 after F3, 165 after F4, 209 after F5.
- **Coverage:** statements 96.09%, branches 89.35%, functions 96.61%, lines 98.61%. Thresholds 90, 85, 90, 90 (T-044; the same figures as T-037).
- **Secret scan:** 99 tracked files, 0 issues (T-044). The clean clone of F5 scanned the same 99 files (T-039).
- **Audit:** `npm audit` went from 10 moderate advisories to 0 after the minimatch override (T-007, S-004). The CI audit job passed for F2 to F5 (T-040 to T-043).
- **Mutation checks:** three, each caught and then restored byte for byte: the `noUnusedLocals` guard (T-005), the seed checksum (T-018), and the field-name redaction rule (T-036).
- **Pre-commit hook:** refused two commits in testing (a generated throwaway seed, T-019; a literal password in a test sample, S-007). Accepted the F3, F4 and F5 commits (T-020, T-031, T-038).
- **Clean clones:** each feature commit, F1 to F5, was cloned into an empty folder and passed `npm ci` and `npm run check` (T-008, T-012, T-022, T-032, T-039). For F3 to F5, the install alone enabled the hook.
- **GitHub CI:** four runs for F2 to F5, each with both jobs successful (T-040 to T-043).

### How Gate 0 supports the four disciplines

- **Prompt engineering:** the extraction schema (F4, T-024) requires each value to carry its source quote and makes an absent value an explicit null, so the model can abstain rather than guess. No prompt exists yet. Prompt evaluation begins in Gate C (unverified).
- **Context engineering:** the redaction layer (F5, T-034 to T-036) keeps secrets and personal identifiers out of logs. Nothing yet controls what may enter a model's context; that is the prompt boundary due in Gate C (T-16 in [SECURITY-LOG.md](SECURITY-LOG.md)).
- **Swarm engineering:** not started. Separate agent roles are a Gate C design; nothing in Gate 0 depends on them.
- **Graph engineering:** the stable obligation key (F4, T-028) is the identity that the evidence graph will link across invoice, order, receipt, supplier, policy and ledger outcome. The graph is not built.

### What went wrong and what changed

1. **Ten moderate audit advisories through the lint toolchain** (GHSA-g3hv-75wg-m249). npm's suggested fix would have downgraded ESLint to 9. Fixed with a pinned override to minimatch 11.0.5 (S-004, D-014).
2. **The seed detector required a leading `s`.** That contradicted the claim that the version prefix is not checked. A failing test exposed it; the requirement was removed (D-020).
3. **Invoice numbers differing only in spacing or punctuation gave different obligation keys** (S-010). A duplicate written that way could pass as a new payable. A test showed it; the number is now reduced to letters and digits (D-026).
4. **Node-only code was exported from the platform-neutral entry point** (S-009). Found in our own draft; split into `.` and `./node`, with a test that enforces the split (D-025).
5. **The pre-commit hook refused a literal password in a test sample** (S-007). The sample is now assembled at run time.
6. **The F3 commit landed on the F2 branch by mistake.** Nothing had been pushed. The commit moved to its own branch and the F2 branch was reset to its pushed head, `ebb3b0d`. Pull request #13 is unchanged (BUILD-LOG, F3 entry).
7. **Lint findings were fixed by restructuring code, not by turning rules off, except for six test-only exceptions.** All six are for one rule, `security/detect-non-literal-fs-filename`, on a fixed path or a temporary folder that the test creates, and each has a comment above it. D-023 recorded two; the code now has six.
8. **Two identifier fixtures used twelve-digit bases** where thirteen-digit national IDs were needed. The detection tests failed; the fixtures were corrected and no product code changed (BUILD-LOG, F5 entry).

### Documents updated (R-23)

- **Changed in this pull request:** README (banner, logs row); ENGINEERING (layout as built, test tooling, a Gate 0 row in the delivery gates); PRD (section 10); ISSUES (Gate 0 status note); RULES (R-24 and its checklist row); CONTRIBUTING (phase-report link); COMPLIANCE (personal-information row); BUILD-LOG (phase-close entry); DECISION-JOURNAL (D-037, D-038); TEST-LOG (T-040 to T-044); SECURITY-LOG (T-13 status, S-012); PHASE-REPORTS (this report, new).
- **Changed earlier in Gate 0, on the feature branches:** BUILD-LOG entries for F1 to F5; DECISION-JOURNAL D-011 to D-036; TEST-LOG T-001 to T-039; SECURITY-LOG threat statuses and events S-001 to S-011; ISSUES statuses and dependencies (F3 after F1 and F2; F5 after F3 and F4).
- **No change, and why:** BUILD-BRIEF (Gate 0 uses the stack it proposes, TypeScript on Node 24 with Zod; Vitest, ESLint and Prettier are tooling the brief does not name); TRUST and SOLUTION (no guarantee is proven on a ledger yet); SERVICE-LEVELS and AGENT-RELIABILITY (nothing is measured yet); HACKATHON (scoring, standing and deadlines unchanged); decision records 0001 to 0005 (no change of status); PROBLEM, BUSINESS and WORKSHOP (no new facts).
- **README status table:** unchanged. No product claim changed, and the table's four states do not fit engineering work, so no row was added for Gate 0. Gate 0 is recorded here and in TEST-LOG. If the team wants it in the table, that needs a decision record (R-18).

### Decisions and threats changed

- **Decisions:** D-011 to D-036 recorded during Gate 0. Added at this close: D-037 (stacked pull requests merge in order, with merge commits) and D-038 (a gate closes on merge, and its report is written then).
- **Threats:** T-13 (dependencies and Actions) is implemented, and its checks passed on GitHub for F2 to F5 (T-040 to T-043). T-08 is implemented for the repository and for logs, except provider scanning, which needs the owner (S-005). T-19 and T-21 are implemented. T-02, T-09, T-12 and T-16 are partly implemented; the rest is in Gates B and C. T-20 is an accepted limitation, documented in SECURITY.md. S-012 records the CI results.

### Not done, and carried forward

- **Owner settings (S-005), needed for Gate 0's acceptance:** required checks before merge on main (`check` and `audit`), and GitHub secret scanning with push protection. The account used for this work has push access but not admin rights (checked through the GitHub API), so the owner must set them.
- **Merges, in this order:** #5 and #6 (against main; #12 is based on #6); then #12, #13, #14, #15 and #16, each retargeted to main after its base merges; then "Phase close: Gate 0". No review decision exists on any of them yet.
- **CI on the phase-close pull request:** pending when this report was written. Its result is not recorded here.
- **Not started:** every functional requirement (FR-1 to FR-20). No ledger payment, agent, Warden service or console exists. No customer has been interviewed.

### Next gate

- **First step:** A1, the Testnet provisioning script. One command creates the spending, reserve and supplier accounts, funds them, opens the RLUSD trust lines and records addresses, with no seeds in the repository (ISSUES.md). A2 to A7 follow in order.
- **Decision needed from you:** permission to start Gate A, which creates accounts on XRPL Testnet (no real money), and where the Testnet keys will be stored, since the repository must never hold them. The options are the operating system's credential store for local runs, or Secret Manager, as the build brief proposes.
