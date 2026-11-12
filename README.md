# SignOff

**An AI accounts-payable agent that cannot move money on its own.**

SignOff reads supplier invoices, checks them against purchasing records, and pays the routine ones without a human click. Every payment needs two signatures. The agent holds one. The second belongs to an independent rulebook service, called Warden, that the agent cannot read, edit or talk its way past. If a payment breaks a rule, Warden withholds its signature, and the XRP Ledger will not accept a payment with only one.

> **Status, 11 November 2026: Gate 0 and the Gate A ledger layer are merged. The Warden (Gate B), the invoice agent (Gate C) and the operator console (Gate D) are built and tested on feature branches and are NOT merged. Live Testnet evidence uses a test-issued token, not RLUSD. The RLUSD payment (A3) is blocked until testnet RLUSD is funded, and a real agent-to-Warden-to-Testnet run has not happened.**
> The Warden now signs only at final authorization, after rechecking pause, policy, limits, payee and the ledger, so the agent never holds a usable Warden signature ([issue #45](https://github.com/LethaboMH14/SignOff/issues/45); the live negative proof is not yet run). The agent's model evaluation is SIMULATED. The console, the judge check and a credential check are built and tested in software or on Testnet, as the table below states. Browser layout checks and a live receipt have not run, and nothing is deployed. No customer has been interviewed and no partner is integrated. The screen mockups were approved for build and will be reworked later. See [Status of every claim](#status-of-every-claim) below.

Built for the [Node Engine Hackathon](https://w3node.io/node-engine) at W3Node, Cape Town, in the Agentic Finance track. Submissions close on Friday 13 November 2026 at 23:59 SAST.

## The problem

Paying a supplier is the one finance step that businesses will not automate, because a wrong payment is usually irreversible and the loss usually stays with the payer.

- **Email payment fraud is large and rising.** It cost US$3.05 billion in reported US losses in 2025, and 74% of surveyed US organisations were hit ([FBI](https://www.mcdonaldhopkins.com/insights/news/the-sobering-truth-of-the-fbis-2025-internet-crime-complaint-center-report), [AFP via Nacha](https://www.nacha.org/news/business-email-compromise-attempts-rose-sharply-2025-report-finds)). These are US figures; they show the pattern, not South African scale.
- **Africa is a growing target.** African cybercrime losses rose from US$192 million to US$484 million in a year, and INTERPOL links more than half of it to AI ([INTERPOL 2026](https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-report-finds-AI-linked-to-more-than-half-of-cybercrime-in-Africa)). A secondhand report says 70% of Africa's detections of this fraud were in South Africa; we have not yet confirmed that in INTERPOL's own report.
- **South Africa has no published total for this specific fraud.** For context only: all reported digital banking fraud in South Africa reached R2.4 billion in 2025, up 29% ([SABRIC via BusinessTech](https://businesstech.co.za/news/banking/872115/r2-4-billion-stolen-from-south-africans-over-r21800-per-person/)). That figure is mostly fraud against individuals and **does not measure** invoice-redirection losses.
- **AI agents can be hijacked by text hidden in a document.** In published tests, eight defences that rely on the model policing itself were each broken more than half the time ([Zhan et al., 2025](https://consensus.app/papers/details/cadf2fb6ff3b5d138c4b896604a4e7ba/?utm_source=claude_desktop)).

So the manual check is the only defence, which makes payment slow. When the check is skipped, the money is gone. Handing the job to an AI makes it faster and adds a new way to be robbed. Every figure, with its confidence rating, is in [docs/PROBLEM.md](docs/PROBLEM.md).

## The idea in plain language

Think of a company chequebook that needs two signatures.

- The AI assistant holds one pen and does the paperwork.
- The second pen belongs to a rulebook. The AI cannot change the rulebook or persuade it.
- If a payment breaks a rule, the rulebook does not sign, and the bank refuses a cheque with one signature.
- The "bank" here is a public ledger, so anyone can check that the two-signature requirement is switched on.

## How it works

```mermaid
flowchart LR
    I[Invoice arrives] --> A[Agent extracts fields<br/>and matches PO and goods receipt]
    A -->|proposes payment<br/>signature 1| W{Warden<br/>deterministic rules}
    R[(Verified supplier<br/>payout record)] --> W
    P[(Operator policy<br/>limits, pause)] --> W
    W -->|all rules pass<br/>signature 2| L[XRP Ledger<br/>two-signature account]
    W -->|any rule fails| H[Hold with a plain reason]
    L --> S[Validated RLUSD payment<br/>and explorer link]
    H --> O[Operator console]
    S --> O
```

1. A text PDF invoice arrives and triggers the agent. Nobody clicks.
2. The agent extracts invoice fields with their source text and matches them to a purchase order and a goods-received record.
3. The agent proposes a payment through an MCP tool and signs it. It cannot submit anything alone.
4. Warden checks the proposal against the rules below, using records the agent cannot alter.
5. If every rule passes, Warden adds the second signature and submits an RLUSD payment on XRPL Testnet. The console shows the validated result with an explorer link.
6. If any rule fails, the invoice is held and the operator sees why.

## What the ledger guarantees and what Warden checks

| Guarantee | Enforced by |
|---|---|
| No payment unless signer weights reach the quorum; no single key reaches it | **XRP Ledger**, once the signer list is configured and tested |
| Payee matches the supplier's verified payout record | Warden |
| Invoice matches a purchase order and goods-received record | Warden |
| No duplicate payment | Warden |
| Per-payment, per-supplier and daily limits | Warden |
| Only a plain RLUSD payment; nothing that changes signers or settings | Warden |
| Operator pause stops new payments | Warden |

Once configured and tested, the ledger stops the agent from paying alone, even if the agent is tricked or its key is stolen. The full signer matrix, including why there is no recovery signer, is in [docs/TRUST.md](docs/TRUST.md#signer-configuration-and-every-signing-path). The ledger does **not** check payees, invoices or limits; Warden does, as a separately deployed service. Key holders, supplier enrolment, key rotation, recovery and the limits of supplier-signed records are in [docs/TRUST.md](docs/TRUST.md).

## The rules a payment can break

| Group | Rule | What it stops |
|---|---|---|
| Who is paid | Destination matches the supplier's verified payout record | Fake "our bank details changed" emails |
| Who is paid | New or changed details wait out a cooling-off period and are confirmed out of band | Rushed fraud |
| What is paid | Invoice matches a purchase order and a goods-received record | Invoices for goods never ordered or delivered |
| What is paid | The same supplier and invoice number is never paid twice | Duplicates |
| What is paid | Missing fields or an unsure agent means hold | Hidden instructions in a document |
| How much | Per-payment, per-supplier and daily limits | Large losses and split payments |
| How much | Amount equals the invoice exactly | Inflated or partial payments |
| How | Only a plain payment in the agreed currency | The agent granting itself more power |
| System | Operator pause, one payment in flight, refuse if the ledger cannot be read | Race conditions and failing open |

A human operator sets the limits, the approved suppliers, the cooling-off length and the pause. More in [docs/SOLUTION.md](docs/SOLUTION.md).

## Who it is for

- **The buyer pays and controls.** A business outside South Africa, such as a Lusaka distributor, runs the agent, holds the spending account and sets the limits.
- **The South African supplier is the way in.** It enrols, has its identity and bank account verified, signs its payout details, and invites its buyers. One wholesaler can bring many buyers.

This positioning was accepted by the team on 10 November 2026 ([ADR 0001](docs/decisions/0001-supplier-anchored-reframe.md)) as a **go-to-market hypothesis**. Who buys, who pays and who authorises onboarding have not been validated with any customer. The business case, competitors and a user story are in [docs/BUSINESS.md](docs/BUSINESS.md).

## Status of every claim

| Item | Planned | Live on Testnet | Simulated in demo | Validated with customers |
|---|---|---|---|---|
| Agent run on an invoice file | Yes | Not yet: no end-to-end run against a running Warden on Testnet is recorded ([TEST-LOG T-087](docs/logs/TEST-LOG.md), UNVERIFIED) | Built and tested in software: intake, source-quoted extraction, injection screen, matching, decision log and audit export ([TEST-LOG T-076 to T-086](docs/logs/TEST-LOG.md)). Simulated evaluation on 30 fictional invoices: the pipeline decides 30 of 30 with no false approvals. SIMULATED stand-in, not a model measurement ([simulated report](apps/agent/results/simulated-eval.md); reproduced by [the judge check](docs/logs/TEST-LOG.md), T-116) | Not claimed |
| Live model runs on the labelled set (Groq, Gemini, OpenRouter) | Yes | Not a Testnet step. Measured once per provider on branch feat/C5-live-providers, not merged here. The pipeline model call failed on 21 (Groq), 20 (Gemini) and 22 (OpenRouter) of 30 cases, so its holds are mostly failed calls. UNVERIFIED on this branch | Not applicable | Not claimed |
| Two-signature RLUSD payment | Yes | Not yet: blocked until testnet RLUSD is funded (A3). The same two-signature path has run with a test-issued token ([TEST-LOG T-053](docs/logs/TEST-LOG.md)) | Not applicable | Not claimed |
| Rejection of a single-key payment | Yes | Live on Testnet: the agent alone and the Warden alone were refused with tefBAD_QUORUM ([TEST-LOG T-054](docs/logs/TEST-LOG.md)) | Not applicable | Not claimed |
| Warden rules, holds and operator limits | Yes | Live on Testnet with a test-issued token, not RLUSD: refusals and holds for duplicates, payee, receipt, limit, concurrency, pause, a lowered limit and a non-payment co-signature ([TEST-LOG T-071](docs/logs/TEST-LOG.md)); a frozen line held, then paid ([T-072](docs/logs/TEST-LOG.md)) | Not applicable | Not claimed |
| Supplier enrolment and signed payout record | Yes | Enrolment and two-person approval recorded by the Warden on Testnet ([TEST-LOG T-071](docs/logs/TEST-LOG.md)); signed payout change tested in software only ([T-069](docs/logs/TEST-LOG.md)) | Identity check simulated: a fixed allow-list stands in for bank account verification and registry lookup, and every result says so ([identity.ts](apps/warden/src/identity.ts)) | Not claimed |
| Invoices, suppliers and buyers | Yes, fictional test data | Not claimed | Fictional only: the labelled set of 30 invoices ([fixtures](apps/agent/fixtures/labelled)) | Not claimed |
| Rand conversion and payout to a supplier's bank | Simulated only (D4) | Not claimed | Yes, labelled SIMULATED: the receipt shows a rand figure at a placeholder rate ([TEST-LOG T-105](docs/logs/TEST-LOG.md)) | Not claimed |
| Bank account verification (AVS) | Not built as a separate check | Not claimed | Not built. The simulated identity check above stands in for it | Not claimed |
| Accounting system links (Xero, Sage) | Not claimed | Not claimed | Not built: no code in the repository | Not claimed |
| Signer list: Agent + Warden the only accepted path; each key alone rejected | Yes (ADR 0004 test plan) | Live on Testnet: quorum 2, master key disabled, read back ([TEST-LOG T-052](docs/logs/TEST-LOG.md)); single-key refusals ([TEST-LOG T-054](docs/logs/TEST-LOG.md)) | Not applicable | Not claimed |
| Arduino Warden Switch: one-way pause, Warden-confirmed status; optional RFID | Stretch ([ADR 0005](docs/decisions/0005-arduino-operator-hardware.md)); [judge runbook](docs/ARDUINO-JUDGE-DEMO-RUNBOOK.md) | Not built | Not built: stretch items S1 to S4 are Todo ([ISSUES](docs/ISSUES.md)) | Not claimed |
| Permission delegation | Out of the hackathon build | Not checked (UNVERIFIED) | Not built | Not claimed |
| XRPL credential on verified supplier accounts (attestation only) | Stretch ([ADR 0004 test plan](docs/decisions/0004-workshop-adjustments.md)) | Lifecycle live on Testnet between two test accounts: issue, accept, check and delete all validated ([TEST-LOG T-118](docs/logs/TEST-LOG.md)). Not yet on the provisioned supplier accounts | Not applicable | Not claimed |
| Trust line limit as one exposure layer (not a loss cap) | Yes (ADR 0004 test plan) | Not yet | Not applicable | Not claimed |
| Operator console: payment desk, held invoice and receipt (D0 to D2, D4) | Yes. Mockups approved for build and to be reworked later ([ISSUES](docs/ISSUES.md)) | Receipt re-reads the Testnet transaction in tests; a live receipt has not run ([TEST-LOG T-106](docs/logs/TEST-LOG.md), UNVERIFIED) | Built and tested in software. The desk never shows Paid before ledger validation and reconciliation; the receipt shows the explorer link and the delivered amount ([TEST-LOG T-098 to T-105](docs/logs/TEST-LOG.md)) | Not claimed |
| Limits, second approver for increases, and pause (D3, D3W) | Yes. A second approver for increases is a proposed rule ([ISSUES](docs/ISSUES.md)) | Not run on Testnet | Built and tested in software ([TEST-LOG T-095, T-104](docs/logs/TEST-LOG.md)); the browser check has not run ([T-103](docs/logs/TEST-LOG.md), UNVERIFIED) | Not claimed |
| Mobile layout and accessibility (D5) | Yes | Not applicable | Built; keyboard and accessibility scan in software ([TEST-LOG T-107](docs/logs/TEST-LOG.md)); phone-width browser check UNVERIFIED ([T-108](docs/logs/TEST-LOG.md)) | Not claimed |
| Motion: opening sequence and transitions (D7, proposed) | Yes, proposed | Not applicable | Built; reduced motion turns it off, and the Paid tick appears only after validation ([TEST-LOG T-109](docs/logs/TEST-LOG.md)); runtime checks UNVERIFIED ([T-110](docs/logs/TEST-LOG.md)) | Not claimed |
| Deployment and health checks (D6) | Yes: Warden and console on separate hosts; the host and budget await the owner's confirmation ([D-085](docs/logs/DECISION-JOURNAL.md)) | Synthetic check read the validated ledger; the account and Warden checks were not set up ([TEST-LOG T-112](docs/logs/TEST-LOG.md)). Deployment not performed ([T-114](docs/logs/TEST-LOG.md), UNVERIFIED) | Not applicable | Not claimed |
| Judge check: one command (E3) | Yes ([ISSUES](docs/ISSUES.md)) | Testnet payments UNVERIFIED: the offline command submits none ([TEST-LOG T-116](docs/logs/TEST-LOG.md)) | `npm run judge:check`: payment and injection tests pass, and the simulated labelled set re-runs and matches the committed result, SIMULATED ([T-116](docs/logs/TEST-LOG.md)). Live results UNVERIFIED on this branch | Not claimed |
| Armed-mode heartbeat watchdog (S3, stretch) | Stretch | Not built on this branch | Built and tested on branch feat/S3-watchdog (T-101 there), not merged | Not claimed |
| Customer problem, pricing, willingness to pay | Not applicable | Not applicable | Not applicable | Not validated: no customer has been interviewed ([ISSUES E1](docs/ISSUES.md)) |
| Savings or fraud prevented | Not applicable | Not applicable | Not applicable | None claimed |

This table will be updated with transaction hashes as items go live.

## Hackathon scoring

Judges score three areas, taken from the team's BuilderBase dashboard on 9 November 2026.

| Criterion | Weight | Where the build stands today |
|---|---|---|
| Product design | 33% | Mockups approved for build and to be reworked later. The console screens are built and tested in software; the phone layout and motion are not checked in a browser (UNVERIFIED) |
| Technical UX | 34% | Ledger, Warden, agent and console code exists and is tested in software. No real model-to-Warden-to-Testnet trace, RLUSD proof or deployed console yet ([TEST-LOG T-114](docs/logs/TEST-LOG.md)); browser checks are UNVERIFIED |
| Business/Market Fit | 33% | Narrative and evidence only, no customer validation |

The track requires an autonomous transaction on XRPL Testnet or Devnet, limits enforced outside the agent's control, and a way for a human operator to change them. See [docs/HACKATHON.md](docs/HACKATHON.md).

## Documents

| Read this | For |
|---|---|
| [docs/RULES.md](docs/RULES.md) | **The working contract:** rules every change must meet, definition of done, phase-close checklist |
| [docs/PRD.md](docs/PRD.md) | Product requirements: users, goals, requirements, success measures |
| [docs/ISSUES.md](docs/ISSUES.md) | The build sliced into issues by gate |
| [docs/logs/](docs/logs/) | Build log, decision journal, test log, security log, phase reports |
| [BUILD-BRIEF.md](BUILD-BRIEF.md) | The agreed build, flow, stack and acceptance tests |
| [docs/PROBLEM.md](docs/PROBLEM.md) | Problem statement and sourced evidence with confidence ratings |
| [docs/SOLUTION.md](docs/SOLUTION.md) | Rules, two-signature design, simpler options considered |
| [docs/AGENT-RELIABILITY.md](docs/AGENT-RELIABILITY.md) | How hallucination is contained and measured |
| [docs/ARDUINO-JUDGE-DEMO-RUNBOOK.md](docs/ARDUINO-JUDGE-DEMO-RUNBOOK.md) | Optional Warden Switch stage demo, human veto, safety/failure tests; not yet implemented |
| [docs/SERVICE-LEVELS.md](docs/SERVICE-LEVELS.md) | Service level targets, failure behaviour, fastest reliability measures |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | Obligations, who carries them, and what the build does (not legal advice) |
| [docs/CFO-AGENTIC-FRAUD-SECURITY-RESEARCH-2026-11-10.md](docs/CFO-AGENTIC-FRAUD-SECURITY-RESEARCH-2026-11-10.md) | Implementation requirements: CFO controls, fraud threats, tests, delivery gates (research; none implemented) |
| [docs/TRUST.md](docs/TRUST.md) | Ledger versus Warden guarantees, keys, enrolment, rotation, recovery |
| [docs/BUSINESS.md](docs/BUSINESS.md) | Customer, savings, revenue, feasibility, competitors, regulation |
| [docs/ENGINEERING.md](docs/ENGINEERING.md) | Repository layout, review process, tests, security, release checks |
| [docs/HACKATHON.md](docs/HACKATHON.md) | Event facts, rubric, deadlines, what is unknown |
| [docs/WORKSHOP.md](docs/WORKSHOP.md) | Notes from the Ripple track workshop and what they change |
| [docs/decisions/](docs/decisions/) | Decision records |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Source index |
| [docs/CLAUDE-PLAN.md](docs/CLAUDE-PLAN.md) | Historical plan from 5 November, kept for reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | How to work in this repository |

Where documents differ, the build brief takes precedence.

## Developer setup

Requires Node 24 (see `.nvmrc`).

```bash
npm install    # the one install command: dependencies for every workspace, and the pre-commit secret check in a git checkout
npm run check  # formatting, lint, types, tests with coverage, and build
```

Read [docs/RULES.md](docs/RULES.md) before changing anything. Work starts from an issue in [docs/ISSUES.md](docs/ISSUES.md).

## Honest limits

- **Regulation is unsettled.** South Africa's cross-border crypto rules are still drafts. The August 2026 draft manual would let only individuals, "at this stage", move crypto assets offshore through authorised providers ([SARB](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets)). On 21 October 2026 the Minister of Finance said Treasury will take a different approach and publish a revised second draft ([MTBPS speech](https://www.gov.za/news/budget/minister-enoch-godongwana-mtbps-speech)). The buyer in this design sits outside South Africa for that reason. **This is not legal advice and no qualified lawyer has reviewed it.** See [docs/BUSINESS.md](docs/BUSINESS.md#regulation).
- **A supplier wants rand, not RLUSD.** That depends on a licensed payout partner that has not been contacted.
- **The RLUSD issuer can freeze or claw back the asset.**
- **The ledger does not check payees or limits.** If Warden is compromised together with the agent key, the loss is bounded only by the spending account's actual balance. A trust line limit does not cap that loss.
- **Upstream records can be wrong.** A compromised supplier list, purchase order or operator login defeats a perfect agent. See [docs/TRUST.md](docs/TRUST.md#threats-from-upstream-of-the-agent).
- **A stolen operator login or reserve key is outside this design's protection.** Losing either payment key freezes the small spending balance; recovery means funding a new account.
- **Live model runs did not measure accuracy.** Each provider ran once on the 30-case labelled set, on branch feat/C5-live-providers. The pipeline model call failed on 20 to 22 of 30 cases, so its holds are mostly failed calls. No accuracy is claimed (T-092 to T-094 on that branch).
- Nothing here is production software. Testnet only, no real funds.

## Licence

See [LICENSE](LICENSE).
