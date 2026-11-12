# R6: operator console, audit trail, real-time data and security

Status: research note, docs only. No code changed. Written 12 November 2026 against `origin/feat/console-redesign`, `origin/feat/integrate-gate-c` and `origin/feat/gate-b-warden-controls`, which hold the stack. `main` holds only the foundation.

Labels used below: **REAL** (code or a recorded run exists and was read), **SIMULATED** (fixture, in-memory or labelled stand-in), **UNVERIFIED** (no evidence in the repo or sources, or a source I could not read).

## Limitations first

- **Source depth is uneven.** Ten pages were read by a fetch agent and are quoted from that read. The rest are quoted from search-result snippets and are marked `snippet`. Snippets are not verbatim page text.
- **Failed fetches:** Mercury's separation-of-duties article returned HTTP 403. `date.nager.at` redirected to another host and was not followed. The OWASP LLM Top 10 index page did not contain the LLM01 heading.
- **Not researched:** SOC 2 and SOX ITGC wording, COSO Principle 16 on audit trails (the search returned Principle 16 but nothing on audit trails), and the official ISO 27001:2022 text for Annex A 8.15 (only secondary commentary was found). Those claims are marked as unverified below.
- **Stack state is partial.** The console, agent and Warden code live on three different branches, not one. The FX module and calendar are on `feat/integrate-gate-c`, not on `feat/console-redesign`. The attack suite is on `feat/gate-b-warden-controls`. The brief's file-based references for FX (`docs/FX-AND-CALENDAR.md`) and the attack suite (`docs/ATTACK-SUITE.md`) do not exist on the console branch. I read them where they are.
- **I did not read the CI workflow contents.** `.github/workflows/ci.yml` exists on the console branch. Its steps are UNVERIFIED here.
- Nothing here is a legal opinion. Review rules with counsel before a real-money pilot (BUILD-BRIEF.md, "Problem and user").

## 1. How AP products present approvals, holds and exceptions

What an operator needs in under a minute: the held item, the single rule that fired, the policy version, who may release it, and the evidence trail to the receipt. Design lessons only.

| Product | What the source says (quote) | Source | Evidence type |
|---|---|---|---|
| Ramp | "Use the approval workflow builder to layer and nest conditions and approvers to create your ideal approval routing." | https://support.ramp.com/bill-pay-approvals | fetched |
| Ramp | Approval policies "control who must approve a bill and in what order", while submission policies "control what information must be on the bill before it can be submitted for approval." | https://support.ramp.com/bill-pay-approvals (search snippet, not fetched) | snippet |
| Ramp | "Flagged out-of-policy items can be approved as exceptions by authorized users, with documented justification and higher-level approval, and an audit trail." | https://ramp.com/answers/policy-enforcement/can-violations-be-overridden-or-approved | snippet |
| Ramp | A "Required by submission policy" error comes with an "Override?" link, and that override "applies to submission requirements, not approval routing." | https://support.ramp.com/bill-pay-submission-policies (snippet) | snippet |
| Mercury | "Only approvers who can access the funding account can approve a payment from it." | https://support.mercury.com/hc/en-us/articles/28776049990548-Navigating-approvals | snippet |
| Mercury | "By default, Mercury allows the same person to both create and approve a payment if per-payment approvals are enabled." | https://support.mercury.com/hc/en-us/articles/45985054591508 | snippet only; the page returned 403 |
| Bill.com | A policy "sets an amount threshold"; paying above it "results in an error" until approvers are assigned. | https://developer.bill.com/v2/docs/bill-approval-workflows | snippet |
| Bill.com | "An Administrator can pay a bill regardless of any bill approval policy or the bill's approval status." | https://developer.bill.com/v2/docs/bill-approval-workflows (snippet) | snippet |
| Bill.com | "if you need a different policy to apply to an existing bill or credit, you'll need to delete the bill or credit, make the policy changes, then recreate the bill or credit." | https://support.bill.com/hc/en-us/articles/203692809-Setting-up-an-approval-workflow (snippet) | snippet |
| Stripe Issuing | "Spending controls run before real-time authorizations and can decline a purchase before the issuing_authorization.request is sent." | https://docs.stripe.com/issuing/controls/spending-controls (snippet) | snippet |
| Stripe Issuing | "If you don't respond within 2 seconds, Stripe applies your webhook timeout setting" (paraphrased in the snippet; the 2-second figure is from the search summary, not a verbatim span). | https://docs.stripe.com/issuing/controls/real-time-authorizations (snippet) | snippet |
| Stripe Issuing | "If no authorization controls declined the request and no webhook is configured, Stripe approves the authorization." | https://docs.stripe.com/issuing/controls/real-time-authorizations (snippet) | snippet |

**Design lessons for the SignOff desk (not copying):**

1. **Name one reason per hold, with its policy version.** Ramp's split between submission rules and approval routing is useful. In SignOff, `PAYEE_CHANGED`, `OVER_LIMIT` and `MISSING_EVIDENCE` already exist as reason codes (`apps/agent/src/log/transition-log.ts`, `reasonCode`). Show the reason code, the rule text and the policy version on the same screen.
2. **Separate "who may release" from "who may change the rule".** Mercury's approver-must-access-the-account check is a good pattern. In SignOff the console must not let the same person raise a limit and approve the payment it unlocks (see section 4).
3. **Stripe's fail-closed default is the opposite of what SignOff needs.** Stripe auto-approves when no webhook is configured. SignOff should hold when Warden or the ledger is unreachable (ATK-09 does this, see section 6).
4. **Overrides must be visible.** Bill.com lets an administrator pay regardless of policy. SignOff should not have an override path that skips Warden. If an operator override exists, it must be a logged, second-person action.
5. **Policy changes must not silently alter held items.** Bill.com requires delete-and-recreate for existing bills. SignOff's ATK-10 (lowered limit while a proposal is in flight, REJECTED 409) is the equivalent, and it is already designed.

**What an operator needs in under a minute (design target):** the held invoice ID, the single reason code and its plain sentence, the two values compared (invoice payee vs verified payee; amount vs limit), the policy version, the next legal action (for example "approve a payee change after cooling-off" or "lower limit requires a second approver"), and a link to the receipt or the validated ledger result. This is a design target. It has not been user-tested. The BUILD-BRIEF acceptance item "an unfamiliar operator can explain a hold, lower a limit, and find a receipt" is **UNVERIFIED** until a timed walkthrough is recorded.

## 2. Audit trail: what a defensible per-payment export holds

### What a defensible export contains (design baseline)

For each payment, every state transition with: sequence number, timestamp, from-state and to-state, actor, reason code and plain reasons, policy version, attempt ID, ledger hash (where one exists), and hashes of the evidence used (invoice file, buyer records, quotes). It must hold no document text, personal data or keys. The sources for this baseline are weaker than I would like: NIST SP 800-92 was found only through a 2006 ITL bulletin summary, which says logs "can capture sensitive content such as passwords and email text, and that archived logs need integrity protection too" (https://seclists.org/isn/2006/Oct/121, snippet). ISO 27001:2022 A.8.15 text was not available; secondary commentary says the control requires organisations to "produce, store, protect and analyze records of relevant events" (https://advisera.com/iso27001/control-8-15-logging/, snippet). **Treat both as UNVERIFIED for exact wording.**

### Tamper evidence

- A hash chain (each record carries the hash of the previous record) plus append-only storage is the common pattern. I did not find a primary source here that mandates it. The commentary I found says "implement tamper-evident logging mechanisms" (ISO-related commentary, snippet). **UNVERIFIED as a requirement; a reasonable design choice.**
- Google's Secret Manager guidance says: "Enable data access logs to obtain and analyze the `AccessSecretVersion` request information." (https://docs.cloud.google.com/secret-manager/docs/best-practices, fetched). Use this for secret-access audit, not for payment audit.

### Retention and redaction

Retention periods depend on the operator's jurisdiction and are **UNVERIFIED** here. Redaction rule that the repo already follows: quotes and records appear only as SHA-256 hashes (`apps/agent/src/audit/export.ts`, `AUDIT_NOTICE`).

### How auditors test it

COSO 2013 Principle 16 covers ongoing and separate evaluations. The search found: "Ongoing evaluations are built into the business processes and adjust to changing conditions. Separate evaluations are typically scoped by risk." (https://finance.arizona.edu/internal-control/components/monitoring, snippet). The sources did not cover audit trails. SOX ITGC and SOC 2 testing were **not researched**.

### Comparison with SignOff (stack branch, read)

- **Transition log** (`apps/agent/src/log/transition-log.ts`, branch `origin/feat/console-redesign`, **REAL**): one JSON line per state change, with `seq`, `at`, `correlationId`, `obligationKey`, `fromState`, `toState`, `actor`, `reasonCode`, `reasons`, `policyVersion`, `attemptId`, `ledgerHash` and an `evidence` object. Writes use `appendDurably` and `fsync`. On open, the log checks `seq` continuity and that `fromState` matches the previous state (lines near 138–145). **It has no hash chain.** A line can be edited without detection by the log itself. This is the largest gap in the audit trail.
- **Export** (`apps/agent/src/audit/export.ts`, **REAL**): joins agent transitions with Warden events for the same attempt IDs, sorts Warden events by time, and counts unreadable Warden lines. The `unreadableWardenLines` field is good: a non-zero count marks the export as incomplete. The export has no signature and no hash of its own.
- **Warden events** are read by `warden-events.ts`, which ignores unknown fields. That is defensive, and it means the export cannot prove the Warden's log was complete.
- **Fit to the design baseline:** reason, actor, policy version and evidence hashes are present. Missing: a hash chain or signed export, a per-export hash manifest, and an explicit "end of log" record.

**Recommendation (SHOULD):** add `prevHash` to each transition and a signed manifest on export (a SHA-256 over the ordered records, with the export time). Keep this as a small change to `transition-log.ts`. It is not a live-demo blocker.

## 3. Real-time information

### Ledger state (XRPL)

- "The XRP Ledger never includes a transaction in a ledger version whose ledger index is higher than the transaction's `LastLedgerSequence` parameter." (https://xrpl.org/reliable-transaction-submission.html, **fetched**)
- The docs recommend persisting the transaction hash, `LastLedgerSequence`, sender sequence and latest validated ledger index before or at submission (search snippet, https://xrpl.org/reliable-transaction-submission.html; the archived mirrors are older copies).
- BUILD-BRIEF says "Persist the transaction hash before submission. Reconcile expiry and ledger history before retrying." The stack's Warden code has a "persist before submit" step (`apps/warden/src/payment.ts`, not read in full here). **Partly REAL, partly UNVERIFIED** until I read the submit path.
- Live Testnet evidence: commit `147050b` on `main` records "validated two-signature RLUSD payment on XRPL Testnet (1 RLUSD)", ledger 22255596, `tesSUCCESS`, two signers, read back from the ledger. The commit says it is "pending independent review and exact-head CI". **REAL (recorded in commit message, not re-checked against the ledger in this session).** The 10 RLUSD run is open.
- Trust-line freeze and balance reads: the attack suite models freeze in an in-memory ledger (PIN-03). **SIMULATED.** A live freeze test is not recorded.

### FX rates

Source: `docs/FX-AND-CALENDAR.md` on `origin/feat/integrate-gate-c` (**REAL code and tests on that branch**).

- Frankfurter is "a free exchange rate API for 219 currencies and 39 other assets from 111 central banks and official sources. Rates update throughout the day." (https://frankfurter.dev/, **fetched**). The ECB reference fixing itself is published once per working day (search snippets; the ECB page was not fetched, **UNVERIFIED** on exact time).
- The stack's note says ZAR is covered and ZMW is not: "`GET /v1/latest?base=USD&symbols=ZMW` returns HTTP 404" (`docs/FX-AND-CALENDAR.md`, recorded real request on 2026-11-12).
- Fail-closed/fallback: the live call has a 5-second limit and falls back to a committed fixture on any error, and the fallback is marked `sourceKind: 'fixture'` with a `fallbackReason` (`packages/shared/src/fx/rates.ts`). **Fallback to a stale fixture is not fail-closed for a payment.** It is only acceptable for a labelled receipt. For any control decision, the right rule is to hold, not to use the fixture. The stack currently uses the fixture only for the receipt, so this is a rule to write down, not a bug.
- Price of RLUSD: treated as 1 USD by assumption, labelled on every quote. **SIMULATED.**
- Licence: Frankfurter is an open API with no key. Its licence terms were not read; **UNVERIFIED**. Paid alternatives were not researched.

### Business calendar

- Nager.Date holiday data for ZA and ZM for 2026 is in `packages/shared/src/calendar/fixtures/public-holidays-2026.json` (**REAL**, recorded requests). Coverage is 2026 only; any other year throws `CalendarCoverageError`, which is the right fail-closed behaviour.
- The official site was not fetched (`date.nager.at` redirected to another host). Search snippets say the API has a public key-free v3 endpoint, **UNVERIFIED** against the live site today.
- The 4 November 2026 Election Day entry in ZA's list is flagged in the stack note for checking against the gazette. **UNVERIFIED.**
- Cooling-off: the Warden adds a fixed number of hours (`service.ts:764`, per the note). It does not skip weekends or holidays. The calendar module would change that rule. **Not wired.**

### Staleness and cooling-off rules (recommended)

| Data | Maximum age before hold | If the source is down | Cache |
|---|---|---|---|
| Validated ledger state (balance, trust line, freeze) | Read at the Warden's final authorization, every time | Hold (`LEDGER_UNREADABLE`, ATK-09) | Never cache for authorization |
| FX rate (receipt only) | Stated rate date shown; never used for a control | Fixture, labelled SIMULATED | Daily |
| Holiday calendar | Current year only | `CalendarCoverageError`: refuse the approval | Yearly |
| Payee change cooling-off | Hours, to be replaced by business days | Hold | n/a |

These are recommendations. None is implemented.

## 4. Operator authentication and console security

### What exists (REAL, read)

- **Sessions** (`apps/console/src/server/auth/sessions.ts`): random 32-byte token in an HttpOnly cookie; the server stores only a SHA-256 hash of it; a per-session CSRF token; idle timeout 30 minutes; absolute timeout 8 hours; step-up re-authentication for pause, limit and approval actions that is fresh for 5 minutes.
- **Login guard** (`LoginGuard` in the same area): rate-limits failed logins (exists; behaviour not read in full).
- **Passwords and operators** (`apps/console/src/server/auth/operators.ts`, `passwords.ts`): scrypt hashes; each operator has their own Warden principal and secret, so "two approvals really are two people". The operator file lives outside the repo.
- **HTTP headers** (`apps/console/src/server/http.ts`): a `content-security-policy` header on every response.
- **Bind address** (`apps/console/src/server/main.ts`): listens on loopback only unless the operator names another host.
- **Warden requests** (`apps/warden/src/auth.ts`): HMAC-signed over method, path, timestamp, nonce and body; nonces are remembered for twice the window; a request sent before a process restart is refused; the principal's role must match the route's role.

### Pause route

`apps/warden/src/server.ts` lines 113–119: `/v1/control/pause` and `/v1/control/resume` are served by the **Warden** HTTP server, behind the operator role. The console reaches them through `WardenClient`. So the pause control is **not** separate from the Warden's API surface. The brief asks for a pause that "stops Warden from co-signing"; ATK-11 tests that. The separation the brief wants (pause as a route the console can call but that is not the console's own API) is not in place. **Recommend:** keep the pause on the Warden, but give it its own principal with a narrow role, so a console compromise cannot call other operator routes with the same key.

### Second approver for limit increases

Route `/v1/policy/limits/:id/approve` exists in the Warden (`server.ts` line 129–131). The attack suite covers lowered limits (ATK-10). The requirement that a limit **increase** needs a second approver is partly in place (the route is there; the rule is in `apps/warden/src/service.ts` and was not read in full). **UNVERIFIED** that the rule rejects self-approval. Mercury's approach, that self-approval is off unless an admin turns it on, is a good model (quote in section 1).

### Secrets handling

- The Warden keys file is read once at startup and contains the Warden seed and the callers' request secrets (`apps/warden/src/config.ts` `loadKeys`). Only the Warden process reads it. Secrets must be at least 32 bytes.
- Google's Secret Manager guidance: "Follow the principle of least privilege when granting permissions to secrets." (https://docs.cloud.google.com/secret-manager/docs/best-practices, **fetched**)
- Cloud Run runs services as the default Compute Engine identity unless changed (Google Cloud blog, snippet: "By default, Cloud Run services run with the same identity as Compute Engine VMs"). Recommendation: one identity per service (console, agent, Warden), grant "Secret Manager Secret Accessor" per secret, not per project (third-party guides, snippet; verify against current IAM role docs).
- The brief proposes Cloud Run services with separate identities and Secret Manager. **Not deployed.** Deployment status is UNVERIFIED.

### Least privilege between console, agent and Warden

- The console reads the agent's transition log and never writes it (`main.ts` header comment). **REAL.**
- The agent cannot sign: it holds one signing key; Warden holds the other. ATK-08 shows that one key alone is rejected by the ledger (`tefBAD_QUORUM`, in-memory). **SIMULATED** for the ledger; the two-key design is **REAL** on Testnet per commit `147050b`.
- The agent calls Warden with its own signed principal (`apps/warden/src/auth.ts`, role `agent`).

### OWASP ASVS fit

I could not fetch ASVS 5.0 requirement text. Search snippets point to V7 "Session Management" in 5.0 (third-party skill page, not authoritative). **Level fit (UNVERIFIED as to requirement numbers):** the design targets ASVS Level 2 for the console (session, CSRF, step-up, login rate limit, TLS, logging). Level 3 is not claimed.

### Gaps (console)

- CSRF token checks on every change route were not read in full. **UNVERIFIED** until a test is cited.
- No second approver for a pause or resume. Pause is a stop control, so a single operator is defensible; state this.
- No recorded SSO or MFA. The brief names Firebase Auth as the proposed operator sign-in. The stack uses scrypt password files. Deployment with Firebase Auth is **not built**.

## 5. Cross-cutting threat model

| Attacker | Entry point | Control in SignOff | Residual risk | Covered by attack suite? |
|---|---|---|---|---|
| Fraudster who edits an invoice's payee | Invoice PDF intake | Verified supplier payout record; changed-payee HOLD (ATK-01) | Verifier relies on a simulated identity checker (see below) | Yes, ATK-01, ATK-02 |
| Prompt injection in invoice text | Extraction model | Quotes must be source spans; screen codes (`apps/agent/src/screen/injection.ts`); Warden checks independently | Model can still be misled into a wrong proposal; Warden must hold it | Partly: ATK-02 tests smuggled proposal fields, not model behaviour |
| Single compromised supplier key | Supplier payout-change route | Cooling-off, Warden approval, ATK-03 | Cooling-off is hours, not business days; approval is simulated | Yes, ATK-03 |
| Single compromised signing key | Warden or agent host | Two-signer SPEND quorum; ATK-08 | Key storage on a laptop in testing; Secret Manager not deployed | Yes, ATK-08 (in-memory) |
| Operator account takeover | Console sign-in | scrypt, step-up, idle/absolute timeout, CSRF token | No MFA; operator file on disk | No direct test in the attack suite |
| Operator misuse (raising limits) | Limit route | Second approver (partly); ATK-10 lowered-limit rejection | Increase approval rule unverified | Lowered only, not raised |
| Replayed Warden request | Warden HTTP API | HMAC, nonce, timestamp, restart refusal | Nonce memory lost on restart is covered by refusing old requests | Unit tests (`apps/warden/test/auth.test.ts`); not in attack suite |
| Denial of ledger or FX source | XRPL, Frankfurter | Hold on ledger error (ATK-09); fallback labelled | FX fallback must not reach a control | ATK-09 yes; FX no |
| Duplicate or concurrent payment | Agent retry | Atomic reserve; ATK-05, ATK-06 | In-process only; several Warden instances not tested | Yes |
| Supply chain (npm) | `package-lock.json`, dependencies | Lockfile committed; Dependabot config exists (`.github/dependabot.yml`) | `npm audit` results not read; CI steps UNVERIFIED | No |
| Secrets in repo | Commits | `scripts/secret-scan.ts` and `packages/shared/src/security/secret-patterns.ts` on the console branch (**REAL**) | Scan coverage not tested here; history not scanned | No |
| LLM risks (OWASP LLM Top 10 2025) | Model calls | Three-call cap, abstention, screen codes, untrusted-input framing | LLM01 prompt injection remains top; LLM05 improper output handling depends on the Warden as the sole consequence gate | Partly |

Sources for LLM risks: the OWASP LLM Top 10 2025 list places prompt injection first (LLM01) and renames insecure output to "Improper Output Handling" (LLM05) (snippets from https://www.coralogix.com/ and https://www.invicti.com/blog/web-security/owasp-top-10-risks-llm-security-2025; the official index page was fetched but did not contain the list). **Snippet-level.**

API risks: "API2:2023 - Broken Authentication" and API6 "Unrestricted Access to Sensitive Business Flows" (https://api-security.owasp.org/editions/2023/en/0x11-t10 for API2, fetched; API6 from a search snippet). The Warden's rate limits and the console's login guard map to API6 and API2. Limits were not read.

**Simulated identity:** The payee check uses `simulatedIdentityChecker` (`docs/ATTACK-SUITE.md` on `feat/gate-b-warden-controls`). Verified supplier identity is therefore **SIMULATED**, which the brief itself says must be labelled.

## 6. What the demo must show versus what it can claim

| BUILD-BRIEF acceptance item | Evidence | Status |
|---|---|---|
| Supported invoice triggers a live agent run and validated Testnet payment, no approval click | Commit `147050b` (manual Testnet command, 1 RLUSD). The triggering from invoice intake was not verified end to end. | Payment: REAL (commit). Trigger: UNVERIFIED |
| Changed payee, hidden instruction, missing receipt, duplicate, concurrent request, excess amount, single compromised key, ledger timeout, lowered limit | `docs/ATTACK-SUITE.md` on `feat/gate-b-warden-controls`, ATK-01 to ATK-13, PIN-01 to PIN-05 | SIMULATED (in-memory ledger; simulated identity) |
| Unfamiliar operator can explain a hold, lower a limit, find a receipt, on desktop and phone | Console on `feat/console-redesign`; a11y and layout tests exist (`apps/console/test/a11y.test.tsx`, `web-shell.test.tsx`) | UNVERIFIED (no timed walkthrough) |
| Interview with a consenting customer; no claims of validated customers | Not in repo | UNVERIFIED |
| Swarm vs single-prompt baseline | Eval harness `apps/agent/src/eval/` exists | UNVERIFIED for measured improvement |
| Demo valid payment, changed-payee hold, lowered-limit hold; keep recorded backup | Payment: REAL on Testnet. Holds: SIMULATED in attack suite | Mixed |

**Smallest live demo script (recommended):**

1. Valid payment: run the 1 RLUSD two-signature Testnet payment. Show the validated ledger result, the ledger index, and the explorer link. Say "Testnet, two signers, RLUSD from the expected issuer". Do not say "production".
2. Changed-payee hold: submit the altered-payee invoice fixture. Show `PAYEE_CHANGED`, the two payee values, and that nothing was submitted. Label the identity check "simulated allow-list".
3. Lowered-limit hold: lower the per-payment limit with a second approver (if built) or note the limit route is pending, then show `OVER_LIMIT` on the next proposal. Use ATK-10's outcome as the fallback if the live route is not ready.

**Backup recording plan:** record all three steps on the same build, with the commit hash on screen. Keep a second recording of the attack suite table (`npm run attack`), labelled as in-memory. Do not stage a live run that depends on the faucet.

## 7. Gaps and recommendations (ranked)

| # | Gap | Priority | Evidence |
|---|---|---|---|
| 1 | Operator console is not deployed as a live, separately identified service; the demo depends on a local console | MUST-FOR-DEMO | `main.ts` binds loopback; no Cloud Run config read |
| 2 | Changed-payee hold and lowered-limit hold must be shown live on the console, not only as the in-memory suite | MUST-FOR-DEMO | ATK-01, ATK-10 are offline |
| 3 | Confirm the limit-increase second-approver rule rejects self-approval | MUST-FOR-DEMO if a limit is lowered on stage | `service.ts` not read in full |
| 4 | Make the FX fixture unusable for any control decision and write the rule down | MUST-FOR-DEMO (one line) | `rates.ts` fallback |
| 5 | Put the three demo holds into the attack-suite CI run and record the exact-head result | MUST-FOR-DEMO | commit `147050b` says "exact-head CI" pending |
| 6 | Hash chain on transitions and a signed export manifest | SHOULD | `transition-log.ts` has no chain |
| 7 | Pause route with its own narrow principal | SHOULD | `server.ts` 113–119 |
| 8 | Replace hour-based cooling-off with business days using the calendar module, failing closed | SHOULD | `service.ts:764`, `FX-AND-CALENDAR.md` |
| 9 | Read CI workflow; run `npm audit` and the secret scan on the console branch | SHOULD | `ci.yml` not read |
| 10 | Operator MFA or SSO (Firebase Auth as briefed) | LATER | Brief names Firebase Auth; not built |
| 11 | Retention and redaction policy, SOX/SOC 2 mapping, COSO evaluation plan | LATER | Not researched |
| 12 | ZMW exchange-rate source for Zambian receipts | LATER | `FX-AND-CALENDAR.md` |
| 13 | Timed usability walkthrough for "explain a hold, lower a limit, find a receipt" | SHOULD (evidence for the acceptance item) | Not recorded |

## Limitations and what I could not verify

- Stripe, Ramp and Mercury claims are from search snippets, except Ramp's bill-pay approvals page, which was fetched. The Mercury article returned 403.
- OWASP ASVS 5.0 requirement numbers were not confirmed. Level claims are design targets.
- NIST SP 800-63B-4 session timeouts: the normative line "When either timeout expires, the session SHALL be terminated" was not fetched on this run. Secondary summaries give 1 hour inactivity at AAL2 and 15 minutes at AAL3; I did not verify them. Ignore the numbers until checked.
- NIST SP 800-92 and ISO 27001 A.8.15 exact wording were not read.
- XRPL reliable-submission text is from the official page (fetched) and archived mirrors (snippets); the mirrors may be outdated.
- Testnet proof: commit message only, not re-read from the ledger in this session.
- I did not run the attack suite, the console, or the tests on any branch. Pass/fail statements are from code reading.
- Frankfurter and Nager.Date licences and rate limits were not read.
- WCAG 3.3.4 (Error Prevention for legal and financial data) was not confirmed from a source. It is my understanding, UNVERIFIED.
- No user interviews or usability sessions have been run.

## How this supports the four engineering lenses (AGENTS.md)

- **Prompt engineering:** the screen codes and the rule "quotes appear only as hashes" reduce what a model can leak through its output.
- **Context engineering:** the console reads the transition log and never writes it; the Warden holds the keys; the console does not see the Warden's secrets.
- **Swarm engineering:** the holds in section 6 are deterministic reason codes, not model judgement.
- **Graph engineering:** the transition log's `fromState` continuity check and the export join are the evidence graph that the audit explanation uses. A hash chain would make that graph tamper-evident (section 2).
