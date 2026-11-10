# Gate D issue bodies (drafts)

**Status: drafts. Nothing is created on GitHub, pushed or branched until Sibusiso approves (RULES R-16 and the instructions for this gate).**

Each body follows [ISSUES.md](../ISSUES.md) and the definition of done in [RULES.md](../RULES.md#5-definition-of-done-for-an-issue). Acceptance criteria are copied from ISSUES.md; the "Done when" lists say how each criterion will be evidenced. Anything not yet run is marked UNVERIFIED in the test log.

Shared rules for every Gate D issue:

- **PC and phone.** The console works at 1280 px wide and at 375 px wide from its first pull request. Each pull request records the checks made at both widths.
- **Labels.** Every state shows a symbol and words. Colour is never the only signal (NFR-5).
- **Simulated.** Anything not real is labelled SIMULATED on screen, in the log and in the video (R-3).
- **Paid.** The console says "Paid" only after the ledger validates the payment and reconciliation records it (R-9).
- **Reasons.** Each reason shown in plain language comes from a logged reason code through a fixed catalogue. Nothing is written per case for display.
- **Secrets.** The browser never receives keys, secrets or signed transaction blobs. Account identifiers are masked by default (R-12).
- **Engineering lenses.** Each pull request explains prompt, context, swarm and graph engineering as AGENTS.md requires. For the console, prompt engineering is mostly not applicable (the console calls no model), so the body says so rather than inventing a role for it.

---

## Proposed additions to ISSUES.md (need approval)

| ID | Title | Why it is needed | Depends | Size |
|---|---|---|---|---|
| D1W | Warden operator read routes for the console | The Warden exposes only POST routes and `/v1/health`. The console cannot read attempts, decisions, limits or suppliers without them | B1, C6 | M |
| D3W | Second operator for limit increases | `setLimits` applies a raise at once, and its own comment says the second approver belongs to Gate D. The rule must sit in the Warden, not only in the console | B5, D1W | S |
| D7 | Motion: opening animation and transitions | Requested for the built UI. Specified in the mockups (M-panel), built after D1 | D1 | S |

---

## D0 · Mockups

- **Gate:** D · **Size:** M · **Depends:** none · **Owner:** unassigned
- **Branch:** `feat/D0-mockups`, from `feat/gate-c-agent-reliability`
- **Files:** `docs/gate-d/mockups.html` (four screens, each at desktop and phone width), `docs/gate-d/ISSUE-BODIES.md`
- **Acceptance (ISSUES.md):** Payment desk, held invoice, mobile limits, receipt; reviewed before console code.

**Done when**

1. The four screens are drawn from the two template references supplied: the phone finance app (greeting, hero card, action cards, bottom bar, invoice details with tabs, progress ring, total tiles, black primary button) and the dashboard (KPI tiles, bar chart, state mix). Layout patterns only; no template assets are copied.
2. Each screen shows a desktop frame and a phone frame. The same markup reflows with container queries.
3. Checks, recorded in TEST-LOG: no horizontal scroll at 375 px and at 1280 px for every screen at both frame sizes (done in the preview on 10 November 2026; method in the log entry).
4. Every status uses a symbol and words. The rand payout carries the SIMULATED label. Account digits and hashes are fictional.
5. Sibusiso approves the mockups in chat. Approval is recorded in DECISION-JOURNAL before D1 starts.

**Open at D0**

- ENGINEERING.md names Figma for the four mockups. This branch uses static HTML, which needs no external account. Figma can be added later if the team wants it.
- The reference captures of Ramp, Mercury, Linear and Stripe, which the build brief asks for before designing, are **not yet taken**. They are listed as open in the mockups' review panel.

**Lenses:** prompt: none. Context: fixture data only, labelled fictional. Swarm: none. Graph: the evidence path in M1 and M2 is the state graph of the transition log; D2 binds it to real data.

---

## D1 · Payment desk

- **Gate:** D · **Size:** M · **Depends:** D0, C6, D1W
- **Branch:** `feat/D1-payment-desk`, stacked on D0
- **Acceptance (ISSUES.md):** List with states and plain reasons; never "paid" before validation.

**Scope**

- New workspace `apps/console` (React and Vite, per ENGINEERING.md), with a small Node server in `apps/console/server` that holds operator signing material and calls the Warden. The browser calls only the console server.
- `apps/console/src/model/state.ts`: a pure function from the agent state, the Warden attempt status, the ledger validation and reconciliation to one display state.
- `apps/console/src/model/reasons.ts`: the plain-language catalogue, keyed by every `WardenReasonCode` and by the agent's hold codes.
- Desk view: KPI tiles, daily chart and state mix (sample data labelled SIMULATED SAMPLE), and the queue.
- Responsive from this pull request: container-query layout as in the mockups.

**Done when**

1. Table test over every combination of agent state, Warden status, ledger validation and reconciliation. `Paid` appears only when all three hold: the Warden attempt is `paid`, the ledger result is validated, and reconciliation is recorded.
2. Catalogue test: every `WardenReasonCode` has plain text, and the console renders no reason without a code. Unknown codes show "Reason code X, no plain text yet" and never an invented sentence.
3. Auth test: unauthenticated and wrong-role requests to the console API are refused.
4. Redaction test: API responses contain no `wardenBlob`, `finalBlob`, `txFields`, keys, seeds or full account addresses by default.
5. Layout check at 375 px and 1280 px, recorded in TEST-LOG. If Playwright is not installed, the check is a DOM measurement and is marked as such.
6. Journal, test log, security log (the new read surface, with a threat row), build log and ISSUES.md status updated in the same pull request.

**Lenses:** prompt: none; the console calls no model, and reasons come from codes. Context: the console receives only the fields it displays, with provenance. Swarm: the console shows the agent's model-call count (at most three) from the evidence record, and does not run agents. Graph: the state mapping is the graph of the transition log, rendered as a list.

---

## D1W · Warden operator read routes (proposed)

- **Size:** M · **Depends:** B1, C6 · **Branch:** `feat/D1W-warden-read`, stacked on `feat/gate-c-agent-reliability` before D1

**Scope**

- `GET /v1/ops/overview` (paused state, policy version, limits, daily usage), `GET /v1/ops/attempts`, `GET /v1/ops/attempts/{id}` (status, reasons, ledger index, engine result), `GET /v1/ops/suppliers` (status and masked payee).
- Operator role and signed request, as for the existing operator routes. Agent principals are refused.
- Field allowlist: no signed blobs, no transaction fields, no secrets. Responses are built field by field, never by spreading stored objects.

**Done when**

1. Tests: unauthenticated refused; agent-role refused; operator accepted; a response allowlist test fails if a new field appears; no read route accepts POST.
2. The routes change no state (a test records the event log length before and after each read).
3. Warden tests (146 today) still pass.

**Lenses:** context engineering is the point of this issue: the console receives only the fields it needs. Graph: attempts are returned with their obligation key so the console can join them to the agent log.

---

## D2 · Held-invoice view

- **Gate:** D · **Size:** S · **Depends:** D1
- **Branch:** `feat/D2-held-invoice`, stacked on D1
- **Acceptance (ISSUES.md):** Evidence, failed rule, next action.

**Scope**

- Evidence path: built from the agent's audit export for the obligation (`apps/agent/src/audit/export.ts`, C6) and the Warden attempt record.
- Failed rule: the last hold or refusal code, with its catalogue sentence.
- Next action: a fixed catalogue entry per hold code (for example, for MISSING_EVIDENCE: "Link the purchase order or goods receipt, then propose again"). The catalogue is authored text reviewed by a person, not generated.
- History tab: the transition log for the invoice, showing actor, reason code, policy version and evidence hashes. No document text.
- The enrolled and printed accounts are masked (last four characters).

**Done when**

1. Test: every hold and refusal code has a next-action entry.
2. Test: a held invoice never shows "Paid", and the approval control for a payout change is disabled and says why.
3. Test: the evidence path matches the export for the same obligation (the same moves, in the same order).
4. Logs as in D1.

**Lenses:** graph engineering is the core here: the evidence path is a walk through the state graph of the transition log. Swarm: the path shows which actor (intake, extractor, verifier, matcher, warden) made each move, without any model calls being shown as if they were decisions.

---

## D3 · Limits and pause

- **Gate:** D · **Size:** S · **Depends:** D1, B5, B7, D3W
- **Branch:** `feat/D3-limits-pause`, stacked on D2
- **Acceptance (ISSUES.md):** Change limits (increase needs second approver), pause, resume with authentication.

**Warden side (D3W, proposed):**

- A decrease applies at once, as today (B5).
- An increase is recorded as a pending request. It takes effect only when a second, different operator approves it. The same operator approving twice is refused.
- A pending request expires after 24 hours. This is a proposed rule for review.
- Pause and resume already require a signed operator request (B7). No change needed, but a test pins it.

**Console side:**

- Step-up sign-in before pause, resume or a limit change. The mockup's passcode or passkey choice is a decision (see below).
- The console calls the Warden with the operator's own principal. Each person needs their own principal, so that "two approvers" means two people.

**Done when**

1. Warden tests: a single raise is not applied; a second, different operator applies it and the policy version changes; the same operator twice is refused; a decrease applies on the next proposal; pause and resume refused without a signature.
2. Console test: pause and limit change are never sent without a recent step-up sign-in.
3. Regression: B5 tests pass.
4. Security log: the raise rule and the principal-per-person model, with threat rows.

**Lenses:** prompt: none. Context: the operator's identity is attached to each change in the event log, which is the context the audit needs. Graph: a limit change becomes a new policy version, which every later decision cites.

---

## D4 · Receipt

- **Gate:** D · **Size:** S · **Depends:** D1
- **Branch:** `feat/D4-receipt`, stacked on D3
- **Acceptance (ISSUES.md):** Explorer link, delivered amount, simulated rand payout labelled.

**Scope**

- Explorer link built only from the full 64-character hash, with a fixed base address for Testnet.
- Delivered amount: re-checked against the ledger when the receipt opens, using a read-only transaction lookup, and compared with the Warden's settled record. A mismatch or an unreachable ledger shows a hold, not a receipt.
- Asset label: "test-issued token, not RLUSD" is decided from the issuer and currency configuration, never typed by a user.
- Rand payout: shown only with the SIMULATED label and a placeholder demo rate from configuration. No market rate is claimed.

**Done when**

1. Test: the receipt shows "Paid" only if the ledger validated, the delivered amount matches, and reconciliation recorded it.
2. Test: the explorer link accepts only a 64-character hex hash.
3. Test: the SIMULATED label is present whenever a rand figure is present.
4. Test: an unreachable ledger on re-check shows "Not confirmed on the ledger", not a receipt.
5. TEST-LOG: any receipt used in the video cites a Testnet transaction hash. Until an RLUSD payment runs (A3 is blocked, T-059), receipts are for the test-issued token and are labelled that way.

**Lenses:** context: the receipt re-reads the ledger rather than trusting its own record. Graph: the receipt is the end of the path, linking invoice, attempt, transaction hash and the reconciliation record.

---

## D5 · Mobile and accessibility

- **Gate:** D · **Size:** S · **Depends:** D1 (and D2, D3, D4 for full coverage)
- **Branch:** `feat/D5-mobile-a11y`, stacked on D4
- **Acceptance (ISSUES.md):** Works at phone width; labels not colour alone; keyboard usable.

**Done when**

1. Browser checks at 375 px and 1280 px for every screen, with no horizontal scroll and no element outside the viewport. Playwright if installed; otherwise recorded as UNVERIFIED with the manual method.
2. Automated accessibility scan (axe-core as a dev dependency): no serious or critical violations on the four screens.
3. Keyboard walkthrough: every action reachable with Tab, Enter and Escape. A test checks focus order on the held-invoice screen.
4. Unit test: every state chip has text, and its symbol is hidden from assistive technology.
5. Reduced-motion: no motion when the system asks for it (checked with the D7 settings).

**Lenses:** context: each screen is tested with the same fixtures as the mockups, so the review and the tests agree. Swarm and prompt: none.

---

## D6 · Deployment and health checks

- **Gate:** D · **Size:** M · **Depends:** D1W (for the Warden health detail), D1
- **Branch:** `feat/D6-deploy-health`, stacked on D5
- **Acceptance (ISSUES.md):** Console, agent and Warden deployed separately; health endpoints; synthetic Testnet check.

**Done when**

1. Health endpoints: `GET /v1/health` on the Warden (exists; add version and readiness), `GET /api/health` on the console. The agent has no server, so its health is a status file written by each run (proposal).
2. Synthetic check: a read-only script that reads the validated ledger index, the spending account and the Warden health. It submits no payment. Command `npm run testnet:synthetic` (proposed).
3. Console-down test: with the console stopped, the Warden pause route still works (B7 evidence re-run and logged).
4. Deployment itself is **not performed** without approval of the hosting choice and a budget check. Until then the deployment row in TEST-LOG is UNVERIFIED.

**Decision needed (hosting)**

The Warden keeps its state in local files (`events.jsonl`, `payments-journal.jsonl`) with a directory lock and fsync. Serverless functions do not provide that. Options:

| Option | Warden | Console | Fit |
|---|---|---|---|
| A. Small container host with a persistent disk | Yes | Yes | Closest to the current code. Recommended for the Warden |
| B. Cloud Run, with the brief's Firebase and Firestore | Needs a storage change first | Yes | Brief's choice. Larger change; too much for the time left |
| C. Vercel for the console, a container host for the Warden | Container host | Vercel | Fastest for the console; the Warden still needs option A |

Recommendation: option C, with the Warden on a single container host with a persistent disk. This is a recommendation, not a verified price or limit. Provider access and budget must be confirmed first.

**Lenses:** context: each service has its own identity and secret, so no service can read another's keys (R-14). Graph: the synthetic check walks the same path as a payment, read-only.

---

## D7 · Motion: opening animation and transitions (proposed)

- **Size:** S · **Depends:** D1 · **Branch:** `feat/D7-motion`, stacked on D6 or D5 (order decided at approval)

**Scope (as specified in the mockups)**

- Opening sequence: at most 1.2 s. Cards rise 8 px and fade in, staggered 60 ms. KPI numbers count up in 600 ms. Bars and limit fills grow in 400 to 500 ms.
- Transitions: panel and screen crossfade with an 8 px slide, 180 to 220 ms. Chip and status change in 150 ms, colour and symbol together.
- Paid tick: drawn only after the ledger validates and reconciliation records the payment. Never on an unvalidated payment.
- Pause sheet: slides up in 240 ms; focus moves into it; Escape closes it.
- Reduced motion: when the system asks for it, every motion above is replaced by its final state at once.

**Done when**

1. Test: with reduced motion set, animation durations resolve to zero.
2. Test: the Paid tick is not rendered for any state other than validated and reconciled.
3. Test: every motion element has a text state change alongside it.
4. Frame check: no animation makes content move off-screen at 375 px or 1280 px.
5. Performance: opening sequence stays under 1.2 s on the test machine, recorded in TEST-LOG. If not measured, UNVERIFIED.

**Lenses:** the motion carries no information on its own. It makes the state change noticeable, and the words carry the state.
