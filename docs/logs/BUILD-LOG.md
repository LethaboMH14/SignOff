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
