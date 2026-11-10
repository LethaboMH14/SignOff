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
