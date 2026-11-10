# Work issues

The build sliced into small, reviewable issues. Each maps to a requirement in [PRD.md](PRD.md) and a gate in [ENGINEERING.md](ENGINEERING.md#delivery-gates). Rule R-16 in [RULES.md](RULES.md): no work starts without an issue here.

**How to use this file**

- One issue = one branch = one small pull request. Name the branch after the ID: `feat/A2-signer-list`.
- When work starts, create a matching GitHub issue with the same ID and title, and put its number in the **GH** column.
- Update **Status** in the same pull request that changes it: `Todo`, `Doing`, `Review`, `Done`, `Cut`.
- **Size:** S under 2 hours, M half a day, L a day. Anything larger is split.
- **Owner:** set when work starts. Unassigned issues can be picked by either team member.
- "Done" follows the definition of done in [RULES.md](RULES.md#5-definition-of-done-for-an-issue).

## Gate 0: foundation

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| F1 | Repository scaffold | Monorepo layout from ENGINEERING.md; TypeScript strict; Node 24; one command to install | — | S | Sibusiso (AI-assisted) | [#7](https://github.com/LethaboMH14/SignOff/issues/7) | Review |
| F2 | CI pipeline | Type check, lint, unit tests and build run on every pull request and must pass to merge | F1 | S | Sibusiso (AI-assisted) | [#8](https://github.com/LethaboMH14/SignOff/issues/8) | Review |
| F3 | Secret protection | GitHub secret scanning on; pre-commit check using tested XRPL seed patterns, with a test for true and false positives; `.env` ignored | F1, F2 | S | Sibusiso (AI-assisted) | [#9](https://github.com/LethaboMH14/SignOff/issues/9) | Review |
| F4 | Shared schemas | Zod schemas for invoice extraction, payment proposal, Warden decision, obligation; amounts as integer minor units | F1 | S | Sibusiso (AI-assisted) | [#10](https://github.com/LethaboMH14/SignOff/issues/10) | Review |
| F5 | Log redaction | Logger that removes seeds, keys, bank details and personal data; test proves it | F3, F4 | S | Sibusiso (AI-assisted) | [#11](https://github.com/LethaboMH14/SignOff/issues/11) | Review |

## Gate A: ledger proof

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| A1 | Testnet provisioning script | One command creates spending, reserve and supplier accounts, funds XRP, opens RLUSD trust lines, records addresses (no seeds) | F1, F3 | M | Sibusiso (AI-assisted) | [#20](https://github.com/LethaboMH14/SignOff/issues/20) | Review |
| A2 | Signer list | Agent 1, Warden 1, quorum 2; master key disabled; no regular key; verified by reading the account back | A1 | S | Sibusiso (AI-assisted) | [#21](https://github.com/LethaboMH14/SignOff/issues/21) | Review |
| A3 | Two-signature payment | Validated RLUSD payment with expected delivered amount; hash logged | A2 | M | Sibusiso (AI-assisted) | [#22](https://github.com/LethaboMH14/SignOff/issues/22) | Doing (RLUSD run blocked, T-059) |
| A4 | Single-key rejections | Agent alone and Warden alone rejected; result codes logged | A2 | S | Sibusiso (AI-assisted) | [#23](https://github.com/LethaboMH14/SignOff/issues/23) | Review |
| A5 | Reliable submission | Expiry set, persist before submit, reconcile by validated history, no blind resubmit; timeout test | A3 | M | Sibusiso (AI-assisted) | [#24](https://github.com/LethaboMH14/SignOff/issues/24) | Review |
| A6 | Node failover | Second Testnet node; failover keeps exact transaction identity | A5 | S | Sibusiso (AI-assisted) | [#25](https://github.com/LethaboMH14/SignOff/issues/25) | Review |
| A7 | Rebuild from reserve | Scripted abandon-and-refund path tested | A1 | S | Sibusiso (AI-assisted) | [#26](https://github.com/LethaboMH14/SignOff/issues/26) | Review |

## Gate B: Warden controls

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| B1 | Warden service skeleton | Separate deployment and identity; authenticated proposal endpoint; holds its own key only | F2, A3 | M | Sibusiso (AI-assisted) | [#28](https://github.com/LethaboMH14/SignOff/issues/28) | Review (live with a test-issued token, T-071; RLUSD run blocked by A3) |
| B2 | Obligation identity and reservation | Stable identity; atomic reservation; one unresolved attempt per payable; concurrency test | B1 | M | Sibusiso (AI-assisted) | [#29](https://github.com/LethaboMH14/SignOff/issues/29) | Review (T-069, T-071) |
| B3 | Verified supplier and destination | Destination only from enrolled supplier record; changed payee held | B1 | S | Sibusiso (AI-assisted) | [#30](https://github.com/LethaboMH14/SignOff/issues/30) | Review (T-069, T-071) |
| B4 | Three-way match | Invoice vs purchase order vs goods received, with tolerances; mismatch held | B1 | M | Sibusiso (AI-assisted) | [#31](https://github.com/LethaboMH14/SignOff/issues/31) | Review (T-069, T-071) |
| B5 | Limits | Per-payment, per-supplier, daily; lowered limit applies to the next proposal | B2 | S | Sibusiso (AI-assisted) | [#32](https://github.com/LethaboMH14/SignOff/issues/32) | Review (T-069, T-071) |
| B6 | Transaction-type guard | Only plain RLUSD payment from the expected issuer; everything else refused unless two approvals | B1 | S | Sibusiso (AI-assisted) | [#33](https://github.com/LethaboMH14/SignOff/issues/33) | Review (T-069, T-071) |
| B7 | Pause route | Authenticated pause independent of the console; tested with console stopped | B1 | S | Sibusiso (AI-assisted) | [#34](https://github.com/LethaboMH14/SignOff/issues/34) | Review (T-069, T-071) |
| B8 | Pre-signing ledger read | Balance, trust line freeze state and issuer checked before signing; hold on surprise | B1, A5 | S | Sibusiso (AI-assisted) | [#35](https://github.com/LethaboMH14/SignOff/issues/35) | Review (T-069, T-072) |
| B9 | Supplier enrolment and change | Enrolment with simulated identity check; changes need current key, cooling-off and second approval | B3 | M | Sibusiso (AI-assisted) | [#36](https://github.com/LethaboMH14/SignOff/issues/36) | Review (T-069; enrolment and approval live in T-071) |

## Gate C: agent reliability and evidence

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| C1 | Invoice intake | Watched folder or inbox triggers the workflow; file hashed; text PDF only; others held | F4 | S | | | Review (T-079) |
| C2 | Extraction with source quotes | Strict structured output; each field quoted; code verifies quote and re-parses amount; abstains when unclear | C1 | M | | | Review (T-081) |
| C3 | Prompt-injection handling | Invoice text passed as data; hidden-instruction fixtures cause holds, never actions | C2 | S | | | Review (T-080) |
| C4 | Labelled test set | At least 30 invoices: clean, messy, injected, missing fields, forged payee; labels committed | C2 | M | | | Review (T-078) |
| C5 | Evaluation and baseline | False approvals, false holds, field accuracy, sample size; compared with a single-prompt baseline | C4 | M | | | Review (T-084; live T-088 UNVERIFIED) |
| C6 | Decision log and audit export | Every state transition with reason, actor, policy version, evidence; export per payment | B1 | M | | | Review (T-083) |
| C7 | Workflow wiring | Fixed sequence: intake, extract, match, Warden, submit, reconcile; at most three model calls | C2, B4 | M | | | Review (T-082; live T-087 UNVERIFIED) |

## Gate D: operations and console

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| D0 | Mockups | Payment desk, held invoice, mobile limits, receipt; reviewed before console code | — | M | | | Todo |
| D1 | Payment desk | List with states and plain reasons; never "paid" before validation | D0, C6 | M | | | Todo |
| D2 | Held-invoice view | Evidence, failed rule, next action | D1 | S | | | Todo |
| D3 | Limits and pause | Change limits (increase needs second approver), pause, resume with authentication | D1, B5, B7 | S | | | Todo |
| D4 | Receipt | Explorer link, delivered amount, simulated rand payout labelled | D1 | S | | | Todo |
| D5 | Mobile and accessibility | Works at phone width; labels not colour alone; keyboard usable | D1 | S | | | Todo |
| D6 | Deployment and health checks | Console, agent and Warden deployed separately; health endpoints; synthetic Testnet check | B1, D1 | M | | | Todo |

## Gate E: credible pitch

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| E1 | Customer conversation | One consenting finance lead; notes with consent recorded | — | M | | | Todo |
| E2 | README status complete | Every row has its real state and evidence link | A–D | S | | | Todo |
| E3 | Judge check script | One command reproduces the payment and attack suite results | A, B | M | | | Todo |
| E4 | Demo video | Under three minutes; real, simulated and unverified labelled; backup recorded | D | M | | | Todo |
| E5 | Submission | Title, public repo, video on BuilderBase before Thursday night | E4 | S | | | Todo |

## Stretch (only after Gates A and B)

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| S1 | Warden Switch: STOP button and confirmed state | Per [ADR 0005](decisions/0005-arduino-operator-hardware.md) acceptance matrix | B7 | M | | | Todo |
| S2 | Status lights | Green only on validated payment | S1 | S | | | Todo |
| S3 | Armed-mode heartbeat watchdog | Server-side fail closed on lost heartbeat; tested | S1 | M | | | Todo |
| S4 | RFID tag presented | Tag event recorded; receiving approval still required | S1 | S | | | Todo |
| S5 | XRPL credential on suppliers | Issue, accept, check, delete on Testnet ([ADR 0004](decisions/0004-workshop-adjustments.md)) | B3 | M | | | Todo |
