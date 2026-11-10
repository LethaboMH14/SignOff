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

> **Review reconciliation (11 November 2026):** PR #5's Markdown rendering correction has now merged into `main`. Gate 0's implementation PRs #12–#16 are merged and their CI evidence is recorded. **The full Gate 0 acceptance checklist is still not complete** until the repository owner enables required CI checks before merge and GitHub secret scanning/push protection (S-005); treat the phase-close merge as an engineering/documentation milestone, not a claim that those repository governance controls are active. The observations below about #5 and #17 being open describe the earlier 10 November drafting snapshot.


**Status:** Built and tested. F1 to F5 are merged into main (pull requests #12 to #16). GitHub CI passed for F2 to F5, including the final F5 head. The phase-close pull request, #17, is open but still based on the F5 branch, which has now merged; it needs retargeting to main before it can merge. Pull request #5 (escaped backticks) is open against main and has no review decision. Gate 0 closes when its pull requests are merged, the phase close included (D-038). Two acceptance points still need the repository owner (see below).

This report was checked against git, GitHub and the logs. The full check was run on the merged tree (T-048).

### Delivered

| Issue | What | Pull request | Commit | Evidence |
|---|---|---|---|---|
| F1 | npm workspaces; strict TypeScript 6.0.3; Node 24 pinned; one install command; ESLint 10 with security rules; Prettier; Vitest 5.1.0 with coverage thresholds; guard tests | #12, merged (head 5bc736b) | b07b352 | T-001 to T-008 |
| F2 | CI on every pull request: a check job (format, lint, types, tests, secret scan, build) and an audit job (`npm audit --audit-level=high`); actions pinned to commit SHAs; read-only token; Dependabot with a 7-day cooldown | #13, merged (head ebb3b0d) | dde630e | T-009 to T-012; CI run 42829529654 (T-043) |
| F3 | Checksum-verified XRPL seed detection; secret patterns that report kind and position, never the value; scanner for staged content; pre-commit hook; CI scan; hook enabled by the install | #14, merged (head fea620b) | 0527436 | T-013 to T-022; CI run 42831445900 (T-044) |
| F4 | Integer minor-unit money with a strict invoice-text parser; Zod schemas for invoice extraction, payment proposal, Warden decision and obligation; stable obligation key; platform-neutral and Node-only entry points | #15, merged (head 555ad46) | 1b353d9 | T-023 to T-032; CI run 42832703291 (T-045) |
| F5 | Log redaction in text and in structure; personal-identifier detection with check digits; fail-safe logger; then the independent review's two fixes | #16, merged (approved; head 3812f4b) | 7031e35; review fixes b1af305, 7c67c80, e4244ea, 0eba60f; log commits b25499c, 4f5f218, 3812f4b | T-033 to T-039; review T-040 and T-041; CI runs 42833682423 (T-046, at a90c552), 42835936809 (T-042, at 0eba60f) and 42836359912 (T-049, at 3812f4b) |

Since 0eba60f, the F5 branch adds only log documents (three commits), so the code CI tested at 3812f4b is the code it tested at 0eba60f (T-042).

### Acceptance (ISSUES.md)

| Issue | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| F1 | Monorepo layout; TypeScript strict; Node 24; one command to install | Met | T-001 to T-008 |
| F2 | Type check, lint, unit tests and build run on every pull request | Met | T-009 to T-012; T-043 |
| F2 | Must pass to merge | Not yet: needs the required-checks setting, which the owner must set (S-005) | S-005 |
| F3 | Pre-commit check with tested XRPL seed patterns, with true and false positive tests | Met | T-013 to T-019 |
| F3 | `.env` ignored | Met | F1 guard tests (T-004) |
| F3 | GitHub secret scanning on | Not yet: owner setting (S-005) | S-005 |
| F4 | Zod schemas for the four contracts; integer minor units | Met | T-023 to T-032 |
| F5 | Logger removes seeds, keys, bank details and personal data; a test proves it | Met, including the review's two fixes | T-033 to T-041 |

### Numbers

- **Tests:** 211 passed in 17 test files on the merged tree (T-048). By gate: 6 (F1), 78 after F3, 165 after F4, 209 after F5 at 7031e35, and 211 after the review's two regression tests.
- **Coverage:** statements 96.10%, branches 89.35%, functions 96.61%, lines 98.61% (T-048). Thresholds 90, 85, 90, 90. At 7031e35 the figures were 96.09, 89.35, 96.61 and 98.61 (T-037).
- **Secret scan:** 100 tracked files, 0 issues (T-048). The count is one above the earlier 99 because this report became tracked with the phase-close commit.
- **Audit:** `npm audit` went from 10 moderate advisories to 0 after the minimatch override (T-007, S-004). The CI audit job passed for F2 to F5, including the final F5 head (T-043 to T-046, T-049).
- **Mutation checks:** three, each caught and then restored byte for byte: the `noUnusedLocals` guard (T-005), the seed checksum (T-018), and the field-name redaction rule (T-036).
- **Pre-commit hook:** refused two commits in testing (a generated throwaway seed, T-019; a literal password in a test sample, S-007). It accepted the F3, F4 and F5 commits (T-020, T-031, T-038) and the phase-close commit (12 files, 0 issues).
- **Clean clones:** each feature commit, F1 to F5, was cloned into an empty folder and passed `npm ci` and `npm run check` (T-008, T-012, T-022, T-032, T-039). For F3 to F5, the install alone enabled the hook.
- **GitHub CI:** six completed runs on the Gate 0 branches, each with both jobs successful: F2 (T-043), F3 (T-044), F4 (T-045), F5 at a90c552 (T-046), F5 at 0eba60f (T-042) and F5 at 3812f4b (T-049). Three further F5 runs were cancelled when a newer push to the same pull request superseded them; none failed.

### How Gate 0 supports the four disciplines

- **Prompt engineering:** the extraction schema (F4, T-024) requires each value to carry its source quote and makes an absent value an explicit null, so the model can abstain rather than guess. No prompt exists yet. Prompt evaluation begins in Gate C (unverified).
- **Context engineering:** the redaction layer (F5, T-034 to T-036 and the review's T-041) keeps secrets and personal identifiers out of logs. Nothing yet controls what may enter a model's context; that is the prompt boundary due in Gate C (T-16 in [SECURITY-LOG.md](SECURITY-LOG.md)).
- **Swarm engineering:** not started. Separate agent roles are a Gate C design; nothing in Gate 0 depends on them.
- **Graph engineering:** the stable obligation key (F4, T-028) is the identity that the evidence graph will link across invoice, order, receipt, supplier, policy and ledger outcome. The graph is not built, and the key is not yet scoped to the buyer (S-015).

### What went wrong and what changed

1. **Ten moderate audit advisories through the lint toolchain** (GHSA-g3hv-75wg-m249). npm's suggested fix would have downgraded ESLint to 9. Fixed with a pinned override to minimatch 11.0.5 (S-004, D-014).
2. **The seed detector required a leading `s`.** That contradicted the claim that the version prefix is not checked. A failing test exposed it; the requirement was removed (D-020).
3. **Invoice numbers differing only in spacing or punctuation gave different obligation keys** (S-010). A duplicate written that way could pass as a new payable. A test showed it; the number is now reduced to letters and digits (D-026).
4. **Node-only code was exported from the platform-neutral entry point** (S-009). Found in our own draft; split into `.` and `./node`, with a test that enforces the split (D-025).
5. **The pre-commit hook refused a literal password in a test sample** (S-007). The sample is now assembled at run time.
6. **The F3 commit landed on the F2 branch by mistake.** Nothing had been pushed. The commit moved to its own branch and the F2 branch was reset to its pushed head, `ebb3b0d`. Pull request #13 is unchanged (BUILD-LOG, F3 entry).
7. **Lint findings were fixed by restructuring code, not by turning rules off, except for six test-only exceptions.** All six are for one rule, `security/detect-non-literal-fs-filename`, on a fixed path or a temporary folder that the test creates, and each has a comment above it. D-023 recorded two; the code now has six.
8. **Two identifier fixtures used twelve-digit bases** where thirteen-digit national IDs were needed. The detection tests failed; the fixtures were corrected and no product code changed (BUILD-LOG, F5 entry).
9. **An independent review of F5 by Lethabo found two leaks, both fixed and regression-tested.** When the first sink write failed, the fallback record wrote the unredacted service name (S-012, T-040). Redaction covered property values but not property names (S-013, T-041). The fixes are in b1af305, 7c67c80, e4244ea and 0eba60f.
10. **The phase close conflicted with the review.** Both had used T-040 to T-042 and S-012 to S-013 for different entries. Two files had text conflicts (BUILD-LOG and TEST-LOG). SECURITY-LOG merged without a text conflict but had two S-012 rows, which were fixed by hand. Both sides were kept, and the phase-close entries were renumbered (TEST-LOG T-043 to T-047; SECURITY-LOG S-014). The earlier commit a03b97f and its message still use the old numbers; no log history was rewritten.

### Documents updated (R-23)

- **Changed in this phase-close pull request:** README (banner, logs row); ENGINEERING (layout as built, test tooling and counts of 211, Gate 0 row with T-001 to T-049); PRD (section 10, NFR-1 and NFR-4 evidence); ISSUES (Gate 0 note, statuses of F1 to F5); RULES (R-24 and its checklist row); CONTRIBUTING (phase-report link); COMPLIANCE (personal-information row); BUILD-LOG (merge entry and phase-close entry); DECISION-JOURNAL (D-037, D-038); TEST-LOG (T-043 to T-049); SECURITY-LOG (threat rows T-08, T-09, T-13, T-16 and T-21; S-014, S-015; the review finding type); PHASE-REPORTS (this report, new).
- **Changed earlier in Gate 0, on the feature branches:** BUILD-LOG entries for F1 to F5 and the review's entry; DECISION-JOURNAL D-011 to D-036; TEST-LOG T-001 to T-039 and the review's T-040 to T-042; SECURITY-LOG threat statuses, events S-001 to S-011 and the review's S-012 and S-013; ISSUES dependencies (F3 after F1 and F2; F5 after F3 and F4).
- **No change, and why:** BUILD-BRIEF (Gate 0 uses the stack it proposes, TypeScript on Node 24 with Zod; Vitest, ESLint and Prettier are tooling the brief does not name); TRUST and SOLUTION (no guarantee is proven on a ledger yet); SERVICE-LEVELS and AGENT-RELIABILITY (nothing is measured yet); HACKATHON (scoring, standing and deadlines unchanged); decision records 0001 to 0005 (no change of status); PROBLEM, BUSINESS and WORKSHOP (no new facts).
- **README status table:** unchanged. No product claim changed. Gate 0 is recorded here and in TEST-LOG. If the team wants it in the table, that needs a decision record (R-18).

### Decisions and threats changed

- **Decisions:** D-011 to D-036 during Gate 0. Added at this close: D-037 (stacked pull requests merge in order, with merge commits) and D-038 (a gate closes on merge, and its report is written then).
- **Threats:** T-13 is implemented, and its checks passed on GitHub for F2 to F5 (T-043 to T-046 and T-049). T-08 and T-21 are implemented for the repository and for logs; provider scanning for T-08 needs the owner (S-005). T-19 is implemented. T-02, T-09, T-12 and T-16 are partly implemented. T-09 also carries the review's open finding that obligation IDs are not scoped to the buyer (S-015). T-20 is an accepted limitation, documented in SECURITY.md.
- **Events:** S-012 and S-013 (the review's fixes, recorded by the reviewer); S-014 (CI passed for F2 to F5 and the final F5 head); S-015 (open: buyer scope of obligation IDs).

### Not done, and carried forward

- **Owner settings (S-005), needed for Gate 0's acceptance:** required checks before merge on main (`check` and `audit`), and GitHub secret scanning with push protection. The account used for this work has push access but not admin rights (checked through the GitHub API), so the owner must set them.
- **Open finding (S-015):** obligation IDs are not scoped to the buyer. It must be fixed before any multi-buyer use. It is not scheduled yet.
- **Durability of logs:** best-effort operational logs are not a durable financial audit trail. Gates B and C must build the independent evidence trail (the review's note).
- **Merges:** pull request #5 (escaped backticks) is open against main and has no review decision. Pull request #17 (this phase close) must be retargeted from the F5 branch to main, and then merged. Its CI runs on the pull request after the push that carries the merge.
- **Not started:** every functional requirement (FR-1 to FR-20). No ledger payment, agent, Warden service or console exists. No customer has been interviewed.

### Next gate

- **First step:** A1, the Testnet provisioning script. One command creates the spending, reserve and supplier accounts, funds them, opens the RLUSD trust lines and records addresses, with no seeds in the repository (ISSUES.md). A2 to A7 follow in order.
- **Decision needed from you:** permission to start Gate A, which creates accounts on XRPL Testnet (no real money), and where the Testnet keys will be stored, since the repository must never hold them. The options are the operating system's credential store for local runs, or Secret Manager, as the build brief proposes.
