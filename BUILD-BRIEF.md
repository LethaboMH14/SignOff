# SignOff build brief

> Updated 10 November 2026 after the team accepted [ADR 0001](docs/decisions/0001-supplier-anchored-reframe.md), [ADR 0002](docs/decisions/0002-plain-multisign-core.md) and [ADR 0003](docs/decisions/0003-no-quantum-in-mvp.md). Trust boundaries are in [docs/TRUST.md](docs/TRUST.md). The technical constraints below are unchanged.

## Problem and user

A buyer outside South Africa, such as a Lusaka solar distributor, pays a South African supplier and must check invoices and any change to payout details. The **buyer** initiates and controls payments: it runs the agent, holds the spending account and sets the limits. The **South African supplier** is the proposed distribution and verification entry point: it enrols, publishes signed payout details and invites its buyers. This positioning is a go-to-market hypothesis. Who buys, who pays and who authorises onboarding still have to be validated with real finance leads.

Rubicon, a South African solar wholesaler, warns customers about messages claiming its banking details have changed. The Solar Guys in Lusaka is a prospect for discovery, not a confirmed customer. Validate the process and cost with a finance lead before claiming adoption.

A supplier's signature only counts once it is linked to an independently verified supplier identity, with an authenticated change and recovery process ([docs/TRUST.md](docs/TRUST.md)).

The demo uses fictional invoices and settles RLUSD to a project-controlled account on XRPL Testnet. Any conversion or payment of ZAR to a supplier is labelled **simulated**. Yellow Card is a candidate rail to investigate, not an integrated partner. Review applicable Zambian and South African rules with counsel before any real-money pilot.

## Core flow

1. A supported text PDF invoice arrives and triggers the agent workflow.
2. The system extracts cited invoice fields and compares them with a purchase order, goods receipt, verified supplier payout record, and the operator's policy.
3. For an eligible invoice the agent proposes a payment. Warden independently checks evidence, identity, amount, destination, duplicate status, and limits.
4. Warden co-signs and submits an eligible RLUSD Testnet payment. The console shows a validated ledger result and a link to the explorer.
5. A changed destination, missing evidence, invalid output, exceeded limit, or unavailable control puts the invoice on hold with an explanation.
6. An authenticated operator can change limits or pause new submissions outside the agent. Already submitted payments remain pending until reconciled.

The agent cannot sign or submit payments alone. Warden is independently deployed and holds its own key. Treasury reserves remain separate from the spending account.

## Engineering requirements

- **Prompt engineering:** Version role prompts, use structured outputs and source spans, and require abstention where evidence is missing. Treat invoice contents as untrusted.
- **Context engineering:** Give each role a bounded set of relevant records with provenance and trust level. Keep keys and unnecessary sensitive information outside model context.
- **Swarm engineering:** An extraction agent identifies invoice fields. Procurement and fraud agents review separate context in parallel. Deterministic logic holds conflicting or incomplete outcomes. Cap the flow at three model calls.
- **Graph engineering:** Use a state graph for intake, reviews, decisions, Warden and reconciliation. Link invoice, order, goods receipt, verified vendor, policy version and ledger outcome in an evidence graph that powers the audit explanation.

## Proposed stack

TypeScript on Node 24, React and Vite for the console, LangGraph.js for orchestration, Zod for schemas, Anthropic Messages API with Claude Haiku for extraction and review, and xrpl.js for ledger operations. Proposed deployment uses separate Cloud Run services and identities for the console, worker and Warden, Firestore for durable state, Firebase Auth for the operator, and Secret Manager for credentials. Confirm provider access, permissions and budget before deployment. A fixture mode is useful for development and must be labelled.

## XRPL spike

Time-box the initial spike to 90 minutes after provisioning Testnet accounts.

**Baseline (accepted, ADR 0002).** Put a signer list on SPEND with Agent and Warden signers and quorum two. Disable SPEND's master key and set no regular key. Keep an offline operator recovery path (see [docs/TRUST.md](docs/TRUST.md)). Verify a validated RLUSD payment with both signatures, rejection with the Agent key alone, rejection with the Warden key alone, and that an operator pause stops Warden from co-signing. Record actual results and transaction hashes.

This baseline does not let the ledger restrict which transaction types the two signers send together. Warden must refuse anything that is not a plain RLUSD payment, and documentation must say this is a Warden check, not a ledger guarantee.

**Optional enhancement.** Only after the baseline, console and attack suite work, and only after confirming on Testnet that the feature is enabled: configure SPEND with Payment delegation to a CONTROL account with the same two signers. Verify rejection of an unauthorised transaction type and operator revocation before claiming either.

Warden verifies the exact issuer, destination, tag, amount, per-payment and daily limits, and stable vendor-plus-invoice identity. Atomically reserve spend and allow one unresolved transaction per account. Persist the transaction hash before submission. Reconcile expiry and ledger history before retrying. Only show paid when the validated result and delivered amount match. Calculate exposure from actual spendable balances. Never put keys or invoice data in public ledger memos.

References: [permission delegation](https://xrpl.org/docs/concepts/accounts/permission-delegation), [multi-signing](https://xrpl.org/docs/concepts/accounts/multi-signing), [reliable submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission), [Testnet faucet](https://xrpl.org/resources/dev-tools/xrp-faucets), [RLUSD faucet](https://tryrlusd.com/), [explorer](https://testnet.xrpl.org/).

## Operator experience

Use a finance operations desk with a warm paper background, midnight-blue ink, cobalt for verified progress and amber for exceptions. Show a payment evidence path from invoice through checks and policy to settlement. Stop the path at a changed payout destination. A mobile layout shows controls and a readable audit timeline.

Study [Ramp](https://ramp.com/accounts-payable), [Mercury](https://support.mercury.com/hc/en-us/articles/28768945847316-Bill-Pay-overview), [Linear](https://linear.app/) and [Stripe](https://stripe.com/) for approval cues, navigation and visual emphasis. Capture desktop and phone references before designing.

Create and link four labelled design mockups: payment desk, changed-payout hold, mobile operator limits, and validated ledger receipt with simulated ZAR payout. **Mockups are planned and do not yet exist.**

## Acceptance

- A supported invoice triggers a live agent run and validated Testnet payment without a payment approval click.
- A changed payee, hidden instruction, missing receipt, duplicate, concurrent request, excess amount, single compromised key, ledger timeout, and lowered limit each have an observable expected outcome.
- An unfamiliar operator can explain a hold, lower a limit, and find a receipt on desktop and phone.
- Record a consenting customer interview and document the current workflow, pilot hypothesis, and unverified partner dependencies. Do not claim validated customers or savings without evidence.
- Compare the swarm with a single-prompt baseline before claiming a measured improvement.
- Demo the valid payment, changed-payee hold, and lowered-limit hold. Keep a recorded backup.

## Prior work and timeline

Reuse ideas from earlier projects, disclose any pre-existing code, and follow the participant guide. The guide specifies a 9 November 17:00 SAST checkpoint, a 13 November 23:59 final deadline, and 14 November judging. Confirm the BuilderBase window. Freeze features and aim to prepare the video and valid entry on 12 November.

The earlier Claude documents are historical. Their regulatory interpretations, track rankings, dates, balances and proposed limits require fresh verification. In particular, draft individual remittance limits are not a B2B policy. Trust-line limits alone do not define total loss exposure.
