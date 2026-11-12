# Ripple Agentic Finance workshop: notes

> **As of 5 November 2026.** These notes record what the presenters said on that date. Later information and corrections are in [Corrections after review](#corrections-after-review-10-november-2026). Nothing here has been checked on Testnet yet.

Notes from the track workshop held online on 5 November 2026 (about 65 minutes), hosted by the W3Node organisers with two presenters from the Ripple side. Written from the meeting's auto-generated transcript, which mishears some product names; names below are corrected where the meaning is clear. The verbatim transcript is kept locally and is not published in this repository.

Track as the team summarises it: **build an AI agent that moves money for a real business, with the XRP Ledger enforcing the rules.**

## Who matters

- **One presenter, a senior developer advocate at Ripple, will be on the ground in Cape Town and is one of the judges.** Expect him to probe how meaningfully the build uses native XRPL features.
- The second presenter, a principal engineer working with Ripple, will support teams online.
- **Prize path:** the track winner gets fast-tracked to an interview for Ripple's UDAX accelerator, launching in Cape Town in January 2027. Organisers stressed "strong projects" and "quality projects".

## What the XRPL offers, as presented

- Layer 1, settles in 3–5 seconds, fixed fee of about 12 drops (a tiny fraction of a cent), no mining, no smart contracts. Financial features are built into the protocol as "amendments" and called through one API.
- **Account reserves:** an account needs 1 XRP to exist plus 0.2 XRP for every object it owns (a trust line, a signer list, a credential and so on). Plan funding for every account.
- **Live on mainnet (so also on Testnet):** multi-purpose tokens (MPTs), token escrow (escrow for issued tokens, not just XRP; RLUSD escrow not available: issuer allowTrustLineLocking false, to be re-read on ledger), **credentials**, permissioned domains, and **batch transactions** (went live about two weeks before the workshop; atomic multi-transaction flows).
- **Described as not live yet, Devnet only (as of 5 November; see corrections):** lending protocol, single-asset vault, **permission delegation**, sponsored fees and reserves, smart escrow.
- **Networks:** mainnet is production; Testnet mirrors mainnet's features; Devnet is for features not yet live.
- **Out of scope for the hackathon:** the XRPL EVM sidechain and community networks. The judges want the XRPL Layer 1.

## Building

- Recommended SDKs: **xrpl.js** (JavaScript/TypeScript) and **xrpl-py**. Others are less maintained.
- Flow: connect to a node, create or import a wallet, build a JSON transaction, sign, submit and wait. Success is `tesSUCCESS`; `tec…` codes mean the transaction was included but failed, and the fee is still charged.
- A simulate call exists to preview a transaction's result against the current ledger before submitting.
- Testnet faucet gives 100 test XRP. RLUSD on Testnet comes from **tryrlusd.com**.
- **Key handling was the one warning repeated:** never commit a seed, and check that AI coding tools do not leave one in a public repository.

## Tokens

- **RLUSD is an IOU token.** Anyone receiving it must first open a **trust line** to the issuer. Every account in the demo that holds RLUSD needs one, and each trust line costs reserve.
- MPTs are recommended for new tokens (better compliance controls, metadata, no rippling), but SignOff uses RLUSD, so it uses trust lines.

## Wallets

- **Privy** was recommended as the default for the hackathon: embedded wallets for users, a dedicated agent-wallet product with built-in policies, and raw signing of any transaction type. Free for developers.
- Xaman: established mobile wallet. Crossmark: browser extension, no longer maintained. GoSig: open-source passkey wallet. XRPL Connect: one SDK for several wallets. Palisade and Ripple Custody: for mature institutions.

## AI agent resources

- **XRPL AI Hub** and the **T54** partner toolkit: SDKs, hosted x402 facilitators, and add-ons such as agent credit lines and risk checks. The presenters were arranging free agent credit for hackathon teams.
- An **XRPL MCP server** to add to Claude Code so the coding assistant can use XRPL documentation, and an **AI starter kit** in the official docs.
- Two agent payment frameworks: **x402** (a facilitator checks the agent paid for the right service) and **MPP** (machine to machine, no middleman; an XRPL MPP SDK is in beta and the presenters want feedback).
- Lending and vault demo: a hosted demo app, open source.

## Questions from other teams

- Escrow: RLUSD escrow not available (issuer allowTrustLineLocking false, to be re-read on ledger).
- Fees do not depend on the amount sent; there is no gas market.
- Lending needs the lending amendment, which is still being voted on.
- Wallet for the hackathon: Privy.

## What this means for SignOff

| Finding | Effect on the plan |
|---|---|
| A Ripple developer advocate is a judge | Use native XRPL features visibly and correctly; show transaction hashes, not slides |
| Permission delegation was described as not yet live | Plain multi-signing stays the core ([ADR 0002](decisions/0002-plain-multisign-core.md)). Later status is disputed; see corrections. Out of the hackathon build either way |
| Credentials are live | Stretch: issue a credential to a supplier account after off-ledger verification, as public evidence of our verifier's statement. It does not prove identity or stop a payment. Test plan in [ADR 0004](decisions/0004-workshop-adjustments.md) |
| RLUSD needs trust lines and reserves | Budget reserves; provision trust lines in the setup script; the trust line limit is one exposure layer, not a loss cap (see corrections) |
| Simulate exists | Warden simulates before co-signing as a preflight only; "paid" is shown only after a validated ledger result |
| Batch transactions are live | Stretch: pay several approved invoices atomically |
| RLUSD escrow not available (issuer allowTrustLineLocking false, to be re-read on ledger) | Stretch: hold a payment in escrow until goods are received, only if the issuer allows it on Testnet |
| Privy recommended, with agent policies | Option: keep the agent's key in a Privy agent wallet so it never sits in our code. Time-boxed; must support multi-signing (unverified) |
| Key handling stressed | GitHub secret scanning, a pre-commit check using tested XRPL seed patterns, seeds only in a secret manager, log redaction, a rehearsed rotation |
| XRPL MCP server and starter kit | Use them during development |
| x402 and MPP | Not core: SignOff pays business invoices, not per-call services. Say so if asked |
| "A real business" | One recorded conversation with a real finance lead is now the top non-code priority |

## Corrections after review (10 November 2026)

From the review of pull request 2 and the [CFO and fraud research](CFO-AGENTIC-FRAUD-SECURITY-RESEARCH-2026-11-10.md):

| Topic | Workshop (5 November) | Later information | Still unverified |
|---|---|---|---|
| Permission delegation | Not yet live | Reviewer reports `PermissionDelegationV1_1` activated on mainnet in October 2026 (see [known amendments](https://xrpl.org/resources/known-amendments)); the copy of that page we read was a September snapshot showing it in voting | Status on our target Testnet |
| Trust line limit | Not discussed as a cap | Official docs: the account's own actions can exceed it, it can be changed, it does not cover XRP ([trust line tokens](https://xrpl.org/docs/concepts/tokens/fungible-tokens/trust-line-tokens)). **Not a loss or spend cap.** | Exact behaviour on Testnet |
| Credentials | Live | An issuer's attestation, not proof of identity or a payment restriction ([credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials)) | Issue, accept, revoke on Testnet |
| Simulate | Exists | Preflight only; ledger state can change ([simulate](https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/transaction-methods/simulate)) | Behaviour under state change and retry |
| Batch | Live about two weeks before | The September amendments snapshot listed the original Batch as disabled and replaced by a corrected version | Status on our target Testnet |

## Links named in the workshop

- XRPL documentation: <https://xrpl.org/docs>
- RLUSD Testnet faucet: <https://tryrlusd.com/>
- Privy agent integrations: <https://docs.privy.io/recipes/agent-integrations/overview>
- XRPL agent wallet skill: <https://xrpl.org/docs/agents/xrpl-agent-wallet-skill>
- x402 on XRPL (T54): <https://xrpl-x402.t54.ai/>
- MPP on XRPL: <https://mpp.dev/payment-methods/xrpl>

Other resources (AI Hub, MCP server, starter kit, XRPL Connect, scaffold, lending demo) were shown on slides; the organisers said they would share the deck.
