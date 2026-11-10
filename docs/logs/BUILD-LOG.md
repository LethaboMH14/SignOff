# Build log

One entry per working session (rule R-19 in [RULES.md](../RULES.md)), newest first. Record what was done, what changed, and what is next. Larger choices get a decision record in [decisions/](../decisions/); smaller ones go in [DECISION-JOURNAL.md](DECISION-JOURNAL.md). At the end of each phase, add a **phase close** entry (rule R-23).

## Entry template

```
### YYYY-MM-DD HH:MM SAST — <who> — <issue IDs>
- Done:
- Changed decisions: (ADR or journal IDs)
- Evidence: (test-log IDs, hashes, PRs)
- Problems / blockers:
- Next:
```

## Phase close template

```
### Phase close: Gate <X> — YYYY-MM-DD
- Gate criteria met: (each criterion with evidence link)
- Not met / carried over:
- Documents updated: (each item in the RULES.md phase-close checklist, or "no change")
- README status table updated: yes / no
- Reviewed by:
```

---

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — merge of the F5 review into the phase close

- Done: merged `feat/F5-log-redaction` (head `3812f4b`, with the independent review fixes) into `docs/phase-close-gate-0` to clear the conflicts on the phase-close pull request. The conflicts were only in BUILD-LOG and TEST-LOG; the code merged without conflicts. Renumbered the phase-close IDs, which had collided with the review's: TEST-LOG T-040 to T-044 became T-043 to T-047, and SECURITY-LOG S-012 became S-014. Removed a stray blank line in the review's security rows so they render in the event table. Re-ran the full check on the merged tree (T-048).
- Changed decisions: none.
- Evidence: T-047 (the phase-close check before the merge), T-048 (the check on the merged tree), T-049 (CI on the current F5 head). Security log: S-014 (CI) and S-015 (an open finding on obligation identity).
- Problems / blockers: S-015 must be fixed before any multi-buyer use. Best-effort logs are not a durable audit trail; Gates B and C must build that.
- Next: retarget the phase-close pull request to main, because its base branch has merged as #16. The remaining items are in PHASE-REPORTS.md.

### 2026-11-10 — independent code review — F5 log redaction

- Done: reviewed the latest stacked F5 implementation and its prerequisite CI and scanner contracts. Repaired two paths missing from the original tests: unredacted service value in a failing-sink fallback and sensitive tokens/PII embedded in JSON property names. Added regression tests, re-ran GitHub CI successfully on exact head `0eba60f` (run #42835936809).
- Changed decisions: none; the corrections enforce the existing no-secret-in-logs design.
- Evidence: T-040 to T-042; security findings S-012 and S-013.
- Problems / blockers: best-effort operational logging is not a durable financial audit store; Gate B and C still must build the independent evidence trail. F4 obligation IDs are not buyer-scoped yet; this must be corrected before multi-buyer payment use.
- Next: review and merge the dependency stack in order with checks, then validate GitHub CI on main. Actual Warden and Testnet functionality remain unimplemented.

### Phase close: Gate 0 — 2026-11-10

- Gate criteria met: F1 (T-001 to T-008); F4 (T-023 to T-032); F5 (T-033 to T-041, including the two review fixes, T-040 and T-041); F2's checks run on every pull request and passed on GitHub (T-043). F3's pre-commit check and its true and false positive tests are met (T-013 to T-019). Not met: F2's "must pass to merge" and F3's GitHub secret scanning need repository settings only the owner can change (S-005). The full acceptance table is in [PHASE-REPORTS.md](PHASE-REPORTS.md).
- Not met / carried over: the repository settings in S-005; the review's open finding that obligation IDs are not scoped to the buyer (S-015); the retarget of the phase-close pull request to main, then its merge. #5 (escaped backticks) is still open against main. Gate 0 closes when its pull requests are merged, this one included (D-038).
- Documents updated: README (banner, logs row); ENGINEERING (layout, tests, Gate 0 row); PRD (section 10); ISSUES (status note and statuses); RULES (R-24 and its checklist row); CONTRIBUTING (phase-report link); COMPLIANCE (personal-information row); DECISION-JOURNAL (D-037, D-038); TEST-LOG (T-043 to T-049); SECURITY-LOG (T-08, T-09, T-13, T-16, T-21 rows; S-014, S-015); PHASE-REPORTS (new). No change: BUILD-BRIEF (Gate 0 uses the stack it proposes), TRUST, SOLUTION, SERVICE-LEVELS, AGENT-RELIABILITY, HACKATHON, decision records 0001 to 0005, PROBLEM, BUSINESS, WORKSHOP.
- README status table updated: no. No product claim changed; the banner changed. Whether Gate 0 belongs in the table is a decision for the team (R-18).
- Reviewed by: F5 was reviewed independently by Lethabo (the review entry above). This phase report is pending review by the other team member.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — F5 log redaction

- Done: F5 (#11) on `feat/F5-log-redaction` in commit `7031e35`: personal-identifier detection with check digits (South African national IDs by date range and Luhn; payment cards by Luhn; email; IBAN; phone); two-layer redaction (text, then structure), with the logger's output limited in depth, width and length; a logger that writes one JSON line per call, validates event names, and never throws; all of it in the Node-only entry point.
- Changed decisions: D-032 to D-036 in the decision journal.
- Evidence: T-033 to T-039 in the test log. 44 new tests (209 in total). A mutation test disabled the field-name rule: three tests failed, the original was restored byte for byte, and all 44 passed again (T-036). The clean clone of `7031e35` passed `npm ci`, `npm run check` and the audit gate (T-039).
- Problems / blockers: (1) Lint flagged variable-index access in the redaction walk and the level lookup; both were restructured with a Map and with `Object.fromEntries` rather than disabled. (2) Our own first draft of the identifier tests used twelve-digit bases where thirteen-digit IDs were needed. The detection failures caught it, and the fixtures were corrected. No product code changed for that. (3) A string spread in a test was flagged and replaced.
- Next: phase close for Gate 0. It needs the CI result of the first GitHub run, and the phase report.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — F4 shared schemas

- Done: F4 (#10) on `feat/F4-shared-schemas` in commit `1b353d9`: integer minor-unit money with a strict invoice-text parser; Zod 4 schemas for the invoice extraction, payment proposal, Warden decision and obligation, with the obligation's invariants enforced on every record; deterministic validation of invoice fields; a stable obligation key; two entry points, one platform-neutral and one Node-only.
- Changed decisions: D-025 to D-031 in the decision journal.
- Evidence: T-023 to T-032 in the test log. 87 new tests (165 in total). The obligation key's known-answer digest was computed independently with `sha256sum`. The clean clone of `1b353d9` passed `npm ci`, `npm run check` and the audit gate, and its platform-neutral build contains no Node imports.
- Problems / blockers: (1) The first draft exported Node-only code from the platform-neutral entry point, which would have blocked browser code from importing it (S-009). (2) A test showed that invoice numbers differing only in spacing or punctuation produced different payables, so a duplicate written that way could pass as new. The number is now reduced to letters and digits (S-010, D-026). (3) Lint flagged a void-returning arrow in the money tests and two file-system warnings in a test-only walk; fixed with braces, and one reasoned disable on each warning line.
- Next: F5 log redaction, as a stacked pull request on F4. Its dependencies are now F3 and F4 (ISSUES updated).

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — F3 secret protection

- Done: F3 (#9) on `feat/F3-secret-protection` in commit `0527436`: a checksum-verified XRPL seed detector (base58 with the Ripple alphabet, double SHA-256); secret patterns that report kind and position, never the value; a scanner that judges staged blobs or index blobs, with a file-name deny list and parsers that fail closed; a pre-commit hook that the real commit path runs; a prepare script that enables the hook on install; `npm run check` now includes the scan; SECURITY.md documents the four layers and their limits.
- Changed decisions: D-020 to D-024 in the decision journal.
- Evidence: T-013 to T-022 in the test log: 78 tests in total, a mutation test that proves the seed tests catch a broken checksum, a real commit refused by the hook, the F3 commit accepted by the same hook, and a clean clone that installs, enables the hook, passes every check and refuses a seed commit.
- Problems / blockers: (1) lint flagged regular expressions with nested repetition and array lookups by variable index; the code was restructured rather than the rules disabled (D-023). (2) The pre-commit hook refused a literal password in a test sample; the sample is now assembled at run time (S-007). (3) The first F3 commit was made on the F2 branch by mistake. Nothing had been pushed: the F3 commit was moved to its own branch and the F2 branch was reset to its pushed head, `ebb3b0d`. Pull request #13 is unchanged.
- Next: F4 shared schemas, as a stacked pull request on F3.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — F2 CI pipeline

- Done: F2 (#8) on `feat/F2-ci` in commit `dde630e`: `ci.yml` runs `npm ci` and `npm run check` on every pull request and on pushes to main, and a separate audit job runs `npm audit --audit-level=high` against the lockfile. Every action is pinned to a commit SHA and checked against its `action.yml`. Permissions are read-only and checkout does not persist the token. `dependabot.yml` proposes weekly npm and Actions updates with a 7-day cooldown.
- Changed decisions: D-018 (CI trust model for public pull requests) and D-019 (pinned actions).
- Evidence: T-009 to T-012 in the test log. The clean clone of `dde630e` passed `npm ci`, `npm run check` and the audit gate (T-012).
- Problems / blockers: the first run on GitHub is not yet recorded; it will be linked in the test log once it completes. Requiring these checks before merge is a repository setting the owner must enable (S-005).
- Next: F3 secret protection, as a stacked pull request on F2.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — F1 repository scaffold

- Done: F1 implemented on `feat/F1-scaffold` in commit `b07b352`: npm workspaces; strict TypeScript 6.0.3; Node 24 pinned; ESLint 10 with typescript-eslint strict and stylistic type-checked rules and eslint-plugin-security; Prettier; Vitest 5.1.0 with v8 coverage thresholds; guard tests for the strictness flags, the Node pin, exact installs, the workspace declaration and the secret-file ignore rules; placeholders for `apps/agent`, `apps/warden`, `apps/console` and `packages/xrpl` that state their gate.
- Changed decisions: D-011 to D-017 in the decision journal.
- Evidence: T-001 to T-008 in the test log. A clean clone of `b07b352` passed `npm ci` and `npm run check` (T-008).
- Problems / blockers: `npm audit` reported 10 moderate advisories through the lint toolchain (GHSA-g3hv-75wg-m249). Fixed with an override to minimatch 11.0.5 (S-004); npm's suggested fix would have downgraded ESLint, so it was not used. Branch protection and GitHub secret scanning are repository settings the current account cannot change (S-005).
- GitHub issues opened for Gate 0: #7 (F1), #8 (F2), #9 (F3), #10 (F4), #11 (F5).
- Next: F2 CI pipeline, as a stacked pull request on F1.

### 2026-11-10 — both — planning, documentation only

- Done: pull requests 1–4 merged (reframe, workshop notes, trust boundaries, reliability, service levels, compliance, review follow-ups, Arduino design). Pull request 5 (formatting fix) open. This pull request adds the working contract: rules, PRD, issues and logs.
- Changed decisions: ADRs 0001–0003 accepted; 0004 accepted as a test plan; 0005 accepted as an optional design direction. Recovery signer removed (journal D-006).
- Evidence: none on the ledger yet. No code exists.
- Problems / blockers: no customer conversation yet; permission-delegation status on Testnet unknown.
- Next: Gate 0 (F1–F5), then Gate A (A1–A4).

### 2026-11-09 — both — research and reframe

- Done: repository created with build brief, historical plan and research index; hackathon rubric and track researched; README rewritten; problem, solution, business, hackathon and engineering documents added (pull request 1).
- Changed decisions: supplier-led positioning and plain multi-signing proposed.
- Evidence: desk research only.
- Next: team review of the reframe.
