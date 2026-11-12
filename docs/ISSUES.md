# Work issues

**Gate 0 status (10 November 2026):** F1 to F5 are merged into main (#12 to #16). The phase-close pull request #17 is merged. CI passed on GitHub for F2 to F5 (T-043 to T-046 and T-049). Gate 0's code and phase report have merged (D-038); owner-controlled repo protections remain unverified. Two acceptance points need the repository owner: F2's required checks before merge, and F3's GitHub secret scanning (S-005). The phase report is in [logs/PHASE-REPORTS.md](logs/PHASE-REPORTS.md).

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
| F1 | Repository scaffold | Monorepo layout from ENGINEERING.md; TypeScript strict; Node 24; one command to install | — | S | Sibusiso (AI-assisted) | [#7](https://github.com/LethaboMH14/SignOff/issues/7) | Done (merged in #12) |
| F2 | CI pipeline | Type check, lint, unit tests and build run on every pull request and must pass to merge | F1 | S | Sibusiso (AI-assisted) | [#8](https://github.com/LethaboMH14/SignOff/issues/8) | Merged (#13); owner settings open (S-005) |
| F3 | Secret protection | GitHub secret scanning on; pre-commit check using tested XRPL seed patterns, with a test for true and false positives; `.env` ignored | F1, F2 | S | Sibusiso (AI-assisted) | [#9](https://github.com/LethaboMH14/SignOff/issues/9) | Merged (#14); owner settings open (S-005) |
| F4 | Shared schemas | Zod schemas for invoice extraction, payment proposal, Warden decision, obligation; amounts as integer minor units | F1 | S | Sibusiso (AI-assisted) | [#10](https://github.com/LethaboMH14/SignOff/issues/10) | Done (merged in #15) |
| F5 | Log redaction | Logger that removes seeds, keys, bank details and personal data; test proves it | F3, F4 | S | Sibusiso (AI-assisted) | [#11](https://github.com/LethaboMH14/SignOff/issues/11) | Done (merged in #16) |

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
| P0 | Final Warden authorization (issue #45) | Proposal returns unsigned terms only; the agent signs; Warden rechecks pause, policy version, limits, payee, ledger and expiry, then signs and submits itself. Offline regression T-079: 3 of 3 pass on head, 3 of 3 fail on pre-fix code. Live Testnet negative proof reported as T-124 in PR #55, not verified here | B1, B5, B7 | M | | [#45](https://github.com/LethaboMH14/SignOff/issues/45) | Review |

## Gate C: agent reliability and evidence

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| C1 | Invoice intake | Watched folder or inbox triggers the workflow; file hashed; text PDF only; others held | F4 | S | | [#37](https://github.com/LethaboMH14/SignOff/issues/37) | Review (T-079) |
| C2 | Extraction with source quotes | Strict structured output; each field quoted; code verifies quote and re-parses amount; abstains when unclear | C1 | M | | [#38](https://github.com/LethaboMH14/SignOff/issues/38) | Review (T-081) |
| C3 | Prompt-injection handling | Invoice text passed as data; hidden-instruction fixtures cause holds, never actions | C2 | S | | [#39](https://github.com/LethaboMH14/SignOff/issues/39) | Review (T-080) |
| C4 | Labelled test set | At least 60 invoices: clean, messy, hidden-instruction injection, missing fields, forged payee, over-limit, duplicate; labels with exact source spans committed | C2 | M | | [#40](https://github.com/LethaboMH14/SignOff/issues/40) | Review (T-078) |
| C5 | Evaluation and baseline | npm run eval (fixture mode): false approvals, false holds, field accuracy, sample size; swarm against a single-prompt baseline with bootstrap CI and Cliff's delta; see docs/EVALUATION.md | C4 | M | | [#41](https://github.com/LethaboMH14/SignOff/issues/41) | Review (T-084; live runs T-092 to T-094 measured on one sample each, no accuracy claim; live T-088 UNVERIFIED) |
| C6 | Decision log and audit export | Every state transition with reason, actor, policy version, evidence; export per payment | B1 | M | | [#42](https://github.com/LethaboMH14/SignOff/issues/42) | Review (T-083) |
| C7 | Workflow wiring | Fixed sequence: intake, extract, match, Warden, submit, reconcile; at most three model calls | C2, B4 | M | | [#43](https://github.com/LethaboMH14/SignOff/issues/43) | Review (T-082; live T-087 UNVERIFIED) |

## Gate D: operations and console

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| D0 | Mockups | Payment desk, held invoice, mobile limits, receipt; reviewed before console code | — | M | | | Built as fixture screens in docs/design/screenshots (T-136); owner rework still pending |
| D1 | Payment desk | List with states and plain reasons; never "paid" before validation | D0, C6 | M | Sibusiso (AI-assisted) | | Review (T-098, T-099; fixture desk at 1440 and 375 captured, T-136; live phone check UNVERIFIED, T-137) |
| D2 | Held-invoice view | Evidence, failed rule, next action | D1 | S | Sibusiso (AI-assisted) | | Review (T-102; hold view with evidence path captured on fixtures, T-136; live browser check not run, T-137) |
| D3 | Limits and pause | Change limits (increase needs second approver), pause, resume with authentication | D1, B5, B7, D3W | S | Sibusiso (AI-assisted) | | Review (T-104, T-134; each limit states its effect in words, T-136; live browser check not run, T-137) |
| D4 | Receipt | Explorer link, delivered amount, simulated rand payout labelled | D1 | S | Sibusiso (AI-assisted) | | Review (T-105, T-134; SIMULATED ZAR payout labelled, T-136; live Testnet receipt not run, T-106) |
| D5 | Mobile and accessibility | Works at phone width; labels not colour alone; keyboard usable | D1 | S | Sibusiso (AI-assisted) | | Review (T-107; 375 px DOM check, no sideways scroll, T-135; keyboard walk not run, T-137) |
| D6 | Deployment and health checks | Console, agent and Warden deployed separately; health endpoints; synthetic Testnet check | B1, D1 | M | Sibusiso (AI-assisted) | | Review (T-111; live check partly run, T-112; deployment not performed, T-114) |
| D1W | Warden operator read routes (proposed) | Read-only views for the console: overview, proposals (holds and payments) and suppliers; operator role only; allowlisted fields; reads write nothing | B1, C6 | M | Sibusiso (AI-assisted) | | Review (T-121; ID proposed, for review) |
| D3W | Second operator for limit increases (proposed) | A raise becomes a pending request; a second, different operator approves it; decreases apply at once; a pending request expires after 24 hours (proposed rule) | B5, D1W | S | Sibusiso (AI-assisted) | | Review (T-095; ID proposed, for review) |
| D7 | Motion: opening animation and transitions (proposed) | Opening sequence at most 1.2 s; transitions 180 to 250 ms; reduced motion turns all motion off; the Paid tick appears only after validation | D1 | S | Sibusiso (AI-assisted) | | Review (T-109; evidence path draws in turn, reduced motion is CSS only; timing and reduced-motion display NOT RUN, T-137) |
| D8 | Live agent map in the console (proposed) | Animated map of invoices moving between agents, from the agent transition log; read-only; SIMULATED replay of the labelled set; Paid only when reconciled | D1 | M | Sibusiso (AI-assisted) | | Review (ID proposed, for review) |

## Gate E: credible pitch

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| E1 | Customer conversation | One consenting finance lead; notes with consent recorded | — | M | | | Todo |
| E2 | README status complete | Every row has its real state and evidence link | A–D | S | Sibusiso (AI-assisted) | | Review (T-119, T-141) |
| E3 | Judge check script | One command reproduces the payment and attack suite results | A, B | M | Sibusiso (AI-assisted) | | Review (T-115, T-116, T-141; live results and Testnet payments UNVERIFIED here) |
| E4 | Demo video | Under three minutes; real, simulated and unverified labelled; backup recorded | D | M | | | Todo |
| E5 | Submission | Title, public repo, video on BuilderBase before Thursday night | E4 | S | | | Todo |

## Stretch (only after Gates A and B)

| ID | Title | Acceptance criteria | Depends | Size | Owner | GH | Status |
|---|---|---|---|---|---|---|---|
| S1 | Warden Switch: STOP button and confirmed state | Per [ADR 0005](decisions/0005-arduino-operator-hardware.md) acceptance matrix | B7 | M | | | Todo |
| S2 | Status lights | Green only on validated payment | S1 | S | | | Todo |
| S3 | Armed-mode heartbeat watchdog | Server-side fail closed on lost heartbeat; tested | S1 | M | Sibusiso (AI-assisted) | | Review (T-101; server side only; Arduino link UNVERIFIED) |
| S4 | RFID tag presented | Tag event recorded; receiving approval still required | S1 | S | | | Todo |
| S5 | XRPL credential on suppliers | Issue, accept, check, delete on Testnet ([ADR 0004](decisions/0004-workshop-adjustments.md)) | B3 | M | Sibusiso (AI-assisted) | | Review (T-117, T-118: lifecycle live on Testnet between two test accounts; not yet on the provisioned supplier accounts) |
