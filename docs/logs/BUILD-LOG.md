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

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — D1W Warden operator read routes

- Done: added read-only operator routes to the Warden (`/v1/ops/overview`, `/v1/ops/proposals`, `/v1/ops/proposals/{id}`, `/v1/ops/suppliers`), with views in `apps/warden/src/ops-view.ts` and 11 HTTP tests in `apps/warden/test/ops-routes.test.ts`. Branch `feat/D1W-warden-read`, stacked on `feat/D0-mockups`.
- Changed decisions: D-072 (read routes and allowlisted views).
- Evidence: T-089 in the test log; `npm run check` exit 0 (57 files, 795 tests).
- Problems / blockers: none in code. Issue IDs D1W, D3W and D7 are proposed and need the reviewer's approval before merge.
- Next: D3W (second approver for limit increases), then D1 (console).

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — D3W second operator for limit increases

- Done: a raise becomes a pending request that a second, different operator approves. A lowering applies at once and closes a waiting raise. A waiting raise lapses after 24 hours (proposed). Routes: `POST /v1/policy/limits` returns applied or pending, and `POST /v1/policy/limits/{id}/approve` approves a raise. The overview shows any waiting raise. Branch `feat/D3W-second-approver`, stacked on `feat/D1W-warden-read`.
- Changed decisions: D-074.
- Evidence: T-095. `npm run check` exit 0 (58 files, 807 tests).
- Problems / blockers: the 24-hour window is a proposed rule for review. The service tests were updated for the new return shape of setLimits. Lowerings behave as before.
- Next: the console (D1), with the live agent map.

### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D8 agent map in the console

- Done: an animated map of invoices moving between the agents, in the console. The server streams the agent's transition log over server-sent events on the loopback address. The browser moves a token to each agent as it acts, shows held moves on the hold lane, and shows paid only for a reconciled move. A feed lists the latest moves in words, with the plain reason for each hold. A replay fixture of the labelled set is labelled SIMULATED. Agent change: the evaluation can export each case's moves (`--transitions`), in commit 38b8717. Branch `feat/D8-agent-map`, stacked on `feat/D3W-second-approver`.
- Changed decisions: D-075.
- Evidence: T-096 (console and export tests) and T-097 (live check of the stream and the page headers). Dependencies recorded in S-042.
- Problems / blockers: the replay is simulated, so it has no ledger or paid moves. Those appear only in a live run with the Warden, which has not run. Phone layout and the motion were not checked by eye. The plain texts for reason codes are drafted and need review.
- Next: the Warden's events on the map, a live run with the Warden, and the payment desk (D1).

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — Gate C issues created and linked
- Done: created issues #37 to #43 for C1 to C7, titled as in docs/ISSUES.md. Each carries its acceptance criteria, dependencies, status, evidence and branch, with the live runs marked UNVERIFIED where they have not been run. Linked them in the GH column of docs/ISSUES.md.
- Changed decisions: none.
- Evidence: the issue list (gh issue list for the repository).
- Problems / blockers: the branch is local and not pushed, so the branch links in the issues do not resolve on GitHub until the push is approved. No pull request exists yet.
### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — Gate C: C1 to C7 agent reliability
- Done: built the agent workspace (`apps/agent`) and the Warden contract package (`packages/warden-api`). Intake (C1), the injection screen (C3), extraction with quote and amount verification (C2), the labelled set of 30 fictional invoices (C4), the evaluation harness with a single-prompt baseline (C5), the decision log and audit export (C6), and the fixed workflow with a three-call budget (C7). The Warden contract, the shared evidence schemas and canonical hashing moved to packages, with re-export shims, and the Gate B tests pass unchanged.
- Changed decisions: D-061 to D-071; [ADR 0006](../decisions/0006-model-boundary-and-providers.md) (Proposed).
- Evidence: TEST-LOG T-076 to T-086 (passing), with the simulated report at `apps/agent/results/simulated-eval.md`. Not run in this session, and marked UNVERIFIED: the live Warden integration (T-087) and any live model measurement (T-088). No provider key and no Warden process were available.
- Problems / blockers: no provider keys in the build session; South African and European amount layouts are held by design (D-070; S-037); the Gate C GitHub issues are not created, because R-16 needs approval; PR #27 (Gate B) is still open.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — Gate B issues created and linked

- Done: after the owner approved it, created the GitHub issues for B1 to B9: [#28](https://github.com/LethaboMH14/SignOff/issues/28) to [#36](https://github.com/LethaboMH14/SignOff/issues/36), with the title, acceptance criteria, dependencies, status, evidence and pull request link for each. Linked each issue in the GH column of `docs/ISSUES.md`. Updated the pull request body, which had said the issues were not yet created.
- Changed decisions: none.
- Evidence: the nine issue links above; the GH column in `docs/ISSUES.md`. No test run: documents and issue creation only.
- Problems / blockers: the first attempt to create the issues from inline text was refused by the shell before it ran any command, so nothing was created by it; the issues were created from prepared files. R-16 asks for an issue before a branch, and this branch was created first; the order is recorded in D-049.
- Next: the owner decides the two readings flagged in the issues: the B2 concurrency reading against BUILD-BRIEF.md, and the B6 reading (D-053). Push this change to the pull request branch.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — Gate B: Warden controls B1 to B9

- Done: Gate B on `feat/gate-b-warden-controls`, stacked on the Gate A branch and not pushed. `apps/warden` holds the decision service for B1 to B9: proposals and co-signature, reservation and duplicates, payee checks, three-way match, limits, the transaction guard, the pause route, the pre-signing ledger read, and supplier enrolment with payout changes. Around it: request authentication, an append-only event log replayed on start, the payment guard, the pre-signing rules, the HTTP surface and the client. The driver `npm run testnet:gate-b` runs the live checks against the Warden as a separate process. `npm run check` passes with 476 tests.
- Changed decisions: D-049 to D-060 in the decision journal.
- Evidence: T-069 to T-074 in the test log: 146 Warden tests on a simulated ledger; live Testnet runs of B1 to B7 (20 checks) and B8 (8 checks) with a test-issued token; a restart from the event log; the lockfile change; a clean-clone check of the committed branch (T-075). Security log: T-27 to T-32 added; T-02, T-09, T-11, T-14, T-15, T-16 and T-26 updated; S-024 to S-031.
- Problems / blockers: (1) B1 depends on A3, and the RLUSD run is still blocked, so every live Gate B row uses a test-issued token (D-058). (2) The GitHub issues for B1 to B9 are not created; R-16 asks for them before work starts, and the owner must approve their creation. (3) A forced stop leaves the Warden's directory lock, which blocks the next start until it is removed by hand; a graceful stop is not built (S-028). (4) Review before the live runs found three defects, each fixed with a regression test: the request-age check could never trigger, co-signature ignored a pause or a pending payout change, and a lapsed reservation blocked its payable (S-024 to S-026). (5) Gate B is not closed. The phase-close pull request (R-23) and review by the other team member are still to do, so the ISSUES status is Review, not Done.
- Next: decide with the owner whether to push and open the pull request, and whether to create the B1 to B9 issues. Fund the spending account with testnet RLUSD so that A3 can run. Run the Gate B live checks once more from a fresh Warden directory before the phase close, so that the record comes from one run.

---

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — Gate A review: re-runs, reconciliation and the rebuild guard

- Done: reviewed the Gate A payment, reconciliation, drill and rebuild code before merge. Wrote regression tests for the defects found; eleven of the new or changed tests failed on the previous code. Fixed: (1) the journal is read before every send, so a settled payment id is never sent again, an unresolved attempt is resumed with its stored blob, and a new attempt follows only an expired one; (2) reconciliation reads the validated ledger before the lookup and expires only beyond the safety margin; (3) the drills refuse a repeated run, and the failover drill treats only its simulated outage as a primary failure; (4) testnet:rebuild runs only with --confirm. CI on the pull request passed at the start of the review.
- Changed decisions: D-046 to D-048 in the decision journal.
- Evidence: T-063 (RLUSD issuer and trust-line flags), T-064 (CI), T-065 (regression tests), T-066 (check), T-067 (live re-runs refused, no transaction), T-068 (ledger re-check). Security log: S-022 and S-023; T-26 updated.
- Problems / blockers: (1) A3 still needs testnet RLUSD in the spending account. The RLUSD issuer and our trust lines do not block a payment (T-063). (2) The proof commands now refuse to repeat a settled payment id, so a new proof payment needs a new id; the commands do not accept one yet. (3) A rebuild that stops partway is not resumable: a second run would treat the half-built account as the one to abandon. Not tested; noted for Gate B. (4) A stale run.lock after a crash needs manual removal, after the journal is inspected; this is by design.
- Next: commit and push the fixes to pull request #19. Fund the spending account with testnet RLUSD, then run `npm run testnet:pay-rlusd`. Gate B needs a decision: its first item (B1) depends on A3.

### 2026-11-10 — Sibusiso with Claude (Haiku 5.5) — Gate A: A1 to A7 ledger proof

- Done: built the Gate A ledger layer in `packages/xrpl` and the Testnet command line in `scripts/testnet` on `feat/gate-a-ledger-proof`, based on main. It covers the endpoint allow-list and network check, amounts and transaction builders, signer configuration with read-back, reconciliation, a journal written before every submission, provisioning (A1), signer configuration (A2), the two-signature payment (A3; test token live, and an RLUSD command that refuses until the account is funded), single-key rejections (A4), reconciliation after a lost response (A5), failover (A6) and rebuild from the reserve (A7). Offline tests run against an in-memory ledger that models the rules. Live runs were made on the XRP Ledger Testnet.
- Changed decisions: D-039 to D-045 in the decision journal.
- Evidence: T-050 (repository check and audit, rerun after a fix), T-051 to T-057 (live Testnet runs), T-058 (independent read-only check), T-059 (RLUSD run BLOCKED), T-060 (provisioning re-run on the final build), T-061 (RLUSD command refused before sending), T-062 (repository check after the RLUSD command). Security log: threats T-22 to T-26; events S-016 to S-021.
- Problems / blockers: (1) A3 needs a testnet RLUSD payment, and the spending account holds no testnet RLUSD. The only source found is a faucet that requires a sign-in, so the RLUSD run is BLOCKED until an operator funds the account. A test-issued token ran instead (D-042). (2) The first run of `npm run check` exited 2 at the type check: two test lines set LastLedgerSequence to undefined, which exactOptionalPropertyTypes rejects. The Vitest run had passed, because Vitest does not type-check. Fixed; the rerun passed (T-050). (3) The primary Testnet endpoint did not answer during the first provisioning run; the cause is unknown (S-019). (4) The logger redacted the token code in trust-line events; the field is renamed (S-018). (5) T-051 predates the logging changes in S-018 and S-019; T-060 re-ran provisioning on the final build. (6) The pre-commit check refused the first commit because a test file held a seed-shaped literal; it is generated at run time now (S-021).
- Next: commit the Gate A work and open a pull request against main. It shares the phase-close files with the phase-close pull request ([LethaboMH14/SignOff#17](https://github.com/LethaboMH14/SignOff/pull/17)), so the logs will conflict when it merges; the size bend is disclosed in D-045. Fund the spending account with testnet RLUSD, then run A3 with `npm run testnet:pay-rlusd`. Create GitHub issues for A1 to A7 as ISSUES.md asks. Write the phase report (R-24) after review and merge.

### 2026-11-10 — independent code review — F5 log redaction

- Done: reviewed the latest stacked F5 implementation and its prerequisite CI and scanner contracts. Repaired two paths missing from the original tests: unredacted service value in a failing-sink fallback and sensitive tokens/PII embedded in JSON property names. Added regression tests, re-ran GitHub CI successfully on exact head `0eba60f` (run #42835936809).
- Changed decisions: none; the corrections enforce the existing no-secret-in-logs design.
- Evidence: T-040 to T-042; security findings S-012 and S-013.
- Problems / blockers: best-effort operational logging is not a durable financial audit store; Gate B and C still must build the independent evidence trail. F4 obligation IDs are not buyer-scoped yet; this must be corrected before multi-buyer payment use.
- Next: review and merge the dependency stack in order with checks, then validate GitHub CI on main. Actual Warden and Testnet functionality remain unimplemented.

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

### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D1 payment desk and operator sign-in

- Done: the desk shows the Warden state (running or paused, limits, usage, a waiting raised limit) and the invoice queue with state, plain reason and model-call count. Paid appears only when the Warden attempt is paid, the ledger is validated and reconciliation is recorded. Password sign-in with roles, a lockout, sessions, a five-minute step-up before any change, form-token and origin checks on every change, and an operator command. Branch `feat/D1-payment-desk`, stacked on `feat/D1-agent-map`, which carries D1W and D3W.
- Changed decisions: D-076 (sign-in), D-077 (display rule).
- Evidence: T-098 (104 console tests; repository check exit 0: 912 tests); T-099 (browser and DOM check).
- Lenses. Prompt engineering: not applicable; the console calls no model, and reasons come from codes. Context engineering: each Warden view and agent record is reduced to the fields the desk shows, by allowlist. Swarm engineering: the desk shows each invoice's model-call count (at most three) from the agent's evidence record and runs no agent. Graph engineering: the display state is a function of the agent's log and the Warden's attempt, joined by attempt id.
- Problems / blockers: the daily chart from the mockups is not built (it is not in the done-when list). The final build's phone check is UNVERIFIED because the built-in browser pane was hidden after the model-call line was added. No accessibility scan has run (D5). The reason texts are drafts. The operator accounts are set up by the team with the operator command; nothing is deployed (D6).
- Next: the held-invoice view (D2).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D2 held-invoice view

- Done: an invoice opens into its held-invoice view: the state, the failed rule with its catalogue sentence, the next step, the Warden's decision, the payout change (approval disabled, with the reason), the masked enrolled account, and the evidence path move by move with reason words and SHA-256 hashes. The path is the audit export's own selection. Branch `feat/D2-held-invoice`, stacked on `feat/D1-payment-desk`.
- Changed decisions: D-078.
- Evidence: T-102 (126 console tests; repository check exit 0: 934 tests). The browser check is not run (T-103).
- Lenses. Prompt engineering: not applicable; no model is called and the next steps are authored text. Context engineering: the view gets only the Warden fields it shows and only the agent moves for the obligation. Swarm engineering: each move names the actor that made it (intake, screen, extractor, verifier, matcher, warden, signer, submitter, reconciler), and the view does not present a model call as a decision. Graph engineering: the evidence path is a walk through the transition log for one obligation, selected by the export's own function.
- Problems / blockers: the browser check is not run (the pane was hidden). Payout approval is not available in the console, by design for this version. The next-step texts are drafts. Test IDs T-101 and D-081 belong to feat/S3-watchdog, so this stack continues from T-102 and D-078; the two stacks need renumbering at merge.
- Next: the limits and pause panel (D3), then the receipt (D4).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D3 limits and pause in the console

- Done: the desk's Warden section has a limits form and a panel for a raised limit that waits. A lowering applies at once; a higher limit waits; the requester cannot approve it. Each change, approval included, asks for the password when the last confirmation is more than five minutes old, and is sent again once it is given. Branch `feat/D3-limits-pause`, stacked on `feat/D2-held-invoice`.
- Changed decisions: D-079.
- Evidence: T-104 (152 console tests; repository check exit 0: 960 tests; coverage above the thresholds). The browser check is not run (T-103).
- Lenses. Prompt engineering: not applicable; no model is called. Context engineering: each change carries the operator's own Warden principal, so the Warden records who asked and who approved, and the desk names the requester only as "you" or by username. Graph engineering: a limit change becomes a new policy version when it applies, and the desk shows the raise as a waiting state until then.
- Problems / blockers: the browser check of the form is not run (the pane was hidden). The 24-hour raise window and the 30-second watchdog are proposed settings for review. The Warden suite covers the limit rules (T-095); the console adds the requester check and the confirmation. The function-coverage threshold was met by testing the browser state rules directly (web/actions.ts) and the browser client with a stubbed fetch, not by changing the threshold. Test IDs T-101 and D-081 belong to feat/S3-watchdog; this stack uses T-102 to T-104 and D-078 to D-079, and the two stacks need renumbering at merge.
- Next: the receipt (D4).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D4 receipt

- Done: a paid payment opens a receipt with the explorer link (a full hash and a fixed base), the amount the ledger delivered, the asset name (decided from configuration), and a rand figure only as a SIMULATED placeholder. The receipt re-reads the transaction from the ledger; any doubt is shown as Not confirmed on the ledger, with its reason, and no receipt. Branch `feat/D4-receipt`, stacked on `feat/D3-limits-pause`.
- Changed decisions: D-082.
- Evidence: T-105 (172 console tests; repository check exit 0: 980 tests). The live Testnet receipt is not run (T-106).
- Lenses. Prompt engineering: not applicable; no model is called. Context engineering: the receipt re-reads the ledger rather than trusting its own record, and it sends the browser only the answer it shows. Graph engineering: the receipt is the end of the path, linking the invoice, the attempt, the transaction hash and the reconciliation the desk shows as Paid.
- Problems / blockers: no live receipt has been checked against Testnet (T-106). No RLUSD payment has run (A3 is blocked, T-059), so receipts are for the test-issued token and are labelled that way. The rand rate is a placeholder from configuration, and no market rate is claimed. The browser check of the receipt is not run (the pane was hidden). Test IDs: T-101 and D-081 belong to feat/S3-watchdog, D-080 to the keys branch; this stack uses T-102 to T-106, D-078 to D-079 and D-082, and the stacks need renumbering at merge.
- Next: the accessibility and phone check (D5), then the health checks and deployment configuration (D6).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D5 accessibility and keyboard checks

- Done: an axe-core scan over the sign-in, payment desk (plain and with a waiting raise), held-invoice and receipt screens, with no serious or critical problem, and keyboard checks on the held-invoice screen. Dev dependencies axe-core, jsdom and @types/jsdom, pinned exactly. Branch `feat/D5-mobile-a11y`, stacked on `feat/D4-receipt`.
- Changed decisions: D-083.
- Evidence: T-107 (7 of 7 pass; repository check exit 0: 987 tests). The browser layout check of the held-invoice, receipt and limits screens is UNVERIFIED (T-108), because the built-in browser pane was hidden.
- Lenses. Prompt engineering: not applicable; no model is called. Context engineering: the scan runs over the same markup the browser receives, so the review and the tests agree. Swarm engineering: not applicable.
- Problems / blockers: the phone and desktop layout of the three later screens is not measured (T-108). Colour contrast is not checked by the scan. The agent map (SVG) scrolls inside its own box at 375 px; that is the existing design, not a page scroll, and it is not a D5 screen. Axe-core is run in jsdom, so it does not see layout-dependent rules.
- Next: the motion layer (D7), then the health checks and deployment configuration (D6).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D7 motion

- Done: the desk's tiles rise in a staggered opening, the KPI numbers climb to their values, the screens crossfade with a small slide, the password sheet slides up and takes focus (Escape closes it), and the Paid tick is drawn only on a Paid chip. Reduced motion replaces every animation with its final state. Branch `feat/D7-motion`, stacked on `feat/D5-mobile-a11y`.
- Changed decisions: D-084.
- Evidence: T-109 (187 console tests; repository check exit 0: 995 tests). The runtime checks are not run (T-110).
- Lenses. Prompt engineering: not applicable. Context engineering: the motion carries no information on its own; every change has its words. Graph engineering: not applicable.
- Problems / blockers: the opening time is computed (700 ms), not measured; the frame check and the sheet's runtime behaviour are UNVERIFIED (T-110), because the browser pane was hidden. The function-coverage margin is narrow (90.88% against 90%).
- Next: the health checks and deployment configuration (D6).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — D6 health checks and deployment preparation

- Done: the Warden's health answer carries its version and readiness; a read-only synthetic Testnet check (`npm run testnet:synthetic`) reads the validated ledger and, when set up, the spending account and the Warden; Dockerfiles for the Warden and the console, a root .dockerignore, and deploy/README.md. Nothing is deployed. Branch `feat/D6-deploy-health`, stacked on `feat/D7-motion`; the issue body says it is stacked on D5, so the order on this stack is D5, D7, D6.
- Changed decisions: D-085.
- Evidence: T-111 (215 Warden and script tests); T-112 (live ledger read OK; account and Warden UNVERIFIED); T-113 and T-114 UNVERIFIED.
- Lenses. Prompt engineering: not applicable. Context engineering: the health answer and the synthetic check see only what they need, and the images see no secrets. Graph engineering: the synthetic check walks the read path of a payment (ledger, account, Warden) without submitting one.
- Problems / blockers: the images are not built; the console-down test is not run as a process test; the account and Warden checks need SIGNOFF_SPENDING_ADDRESS and SIGNOFF_WARDEN_URL; no hosting account or budget is confirmed. Test IDs T-101 and D-081 belong to feat/S3-watchdog, D-080 to the keys branch; this stack uses T-102 to T-114 and D-078 to D-085.
- Next: the README status table and the judge check script (E2 and E3), then the attempt at the Testnet credential check (S5).


### 2026-11-11 — Sibusiso with Claude (Haiku 5.5) — E3 judge check

- Done: `npm run judge:check` runs the payment tests (29 tests in 2 files) and the injection tests (35 tests in 1 file), re-runs the simulated labelled set into a temporary folder and compares it field for field with the committed result, reads the live result files that are committed on this branch, and reports Testnet payments as UNVERIFIED. The report rules and their 17 tests are in `scripts/lib/judge-check.ts`. Branch `feat/E3-judge-check`, stacked on `feat/D6-deploy-health`.
- Changed decisions: D-086.
- Evidence: T-115 (unit tests and checks); T-116 (the offline run, exit 0). Live results and Testnet payments are UNVERIFIED on this branch.
- Lenses. Prompt engineering: not applicable; no prompt changed, and the judge check calls no model. Context engineering: the report carries only check names, statuses and headline numbers, not the text of the labelled cases. Graph engineering: the simulated re-run walks the evaluation from the labelled set through the pipeline and the baseline to the scores, and compares the result with the committed one. Swarm engineering: not applicable.
- Problems / blockers: the live result files are not in this branch's history (they are on feat/C5-live-providers and feat/keys-dotenv), so the judge reports them UNVERIFIED here until the owner decides on a merge. The judge check does not run the Testnet payments, which need the operator keys.
- Next: the README status table (E2), then the Testnet credential attempt (S5).

