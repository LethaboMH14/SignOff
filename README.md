# SignOff

**An AI accounts-payable agent that cannot move money on its own.**

SignOff reads supplier invoices, checks them against purchasing records, and pays the routine ones without a human click. Every payment needs two signatures. The agent holds one. The second belongs to an independent rulebook service, called Warden, that the agent cannot read, edit or talk its way past. If a payment breaks a rule, the second signature never arrives and the XRP Ledger rejects the payment.

> **Status, 9 November 2026: planning and research. No application code exists yet.**
> No payment has been validated, no customer has been interviewed, no partner is integrated, and no mockups exist. Names and examples in these documents are fictional unless a source is linked. Anything that will be simulated in the demo is labelled **simulated**.

Built for the [Node Engine Hackathon](https://w3node.io/node-engine) at W3Node, Cape Town, in the Agentic Finance track. Submissions close on Friday 13 November 2026 at 23:59 SAST.

## The problem

Paying a supplier is the one finance step that businesses will not automate, because a wrong payment is usually irreversible and the loss usually stays with the payer.

- Email payment fraud cost US$3.05 billion in reported US losses in 2025, and 74% of surveyed organisations were hit ([FBI](https://www.mcdonaldhopkins.com/insights/news/the-sobering-truth-of-the-fbis-2025-internet-crime-complaint-center-report), [AFP via Nacha](https://www.nacha.org/news/business-email-compromise-attempts-rose-sharply-2025-report-finds)).
- African cybercrime losses rose from US$192 million to US$484 million in a year, and AI is now linked to more than half of it ([INTERPOL 2026](https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-report-finds-AI-linked-to-more-than-half-of-cybercrime-in-Africa)).
- South African digital banking fraud reached R2.4 billion in 2025, up 29% ([SABRIC via BusinessTech](https://businesstech.co.za/news/banking/872115/r2-4-billion-stolen-from-south-africans-over-r21800-per-person/)).
- AI agents that read documents can be hijacked by text hidden inside them. In published tests, eight defences that rely on the model policing itself were each broken more than half the time ([Zhan et al., 2025](https://consensus.app/papers/details/cadf2fb6ff3b5d138c4b896604a4e7ba/?utm_source=claude_desktop)).

So the manual check is the only defence, which makes payment slow. When the check is skipped, the money is gone. Handing the job to an AI makes it faster and adds a new way to be robbed. The full evidence, with a confidence rating for every figure, is in [docs/PROBLEM.md](docs/PROBLEM.md).

## The idea in plain language

Think of a company chequebook that needs two signatures.

- The AI assistant holds one pen and does the paperwork.
- The second pen belongs to a rulebook. The AI cannot change the rulebook or persuade it.
- If a payment breaks a rule, the second signature never comes and the bank refuses the cheque.
- The "bank" here is a public ledger, so anyone can check that the two-signature rule is really switched on.

## How it works

```mermaid
flowchart LR
    I[Invoice arrives] --> A[Agent extracts fields<br/>and matches PO and goods receipt]
    A -->|proposes payment<br/>signature 1| W{Warden<br/>deterministic rules}
    R[(Supplier-signed<br/>payout record)] --> W
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

## The rules a payment can break

| Group | Rule | What it stops |
|---|---|---|
| Who is paid | Destination matches the supplier's signed payout record | Fake "our bank details changed" emails |
| Who is paid | New or changed details wait out a cooling-off period | Rushed fraud |
| What is paid | Invoice matches a purchase order and a goods-received record | Invoices for goods never ordered or delivered |
| What is paid | The same supplier and invoice number is never paid twice | Duplicates |
| What is paid | Missing fields or an unsure agent means hold | Hidden instructions in a document |
| How much | Per-payment, per-supplier and daily limits | Large losses and split payments |
| How much | Amount equals the invoice exactly | Inflated or partial payments |
| How | Only a plain payment in the agreed currency | The agent granting itself more power |
| System | Operator pause, one payment in flight, refuse if the ledger cannot be read | Race conditions and failing open |

A human operator sets the limits, the approved suppliers, the cooling-off length and the pause. Details and the reasoning for two signatures are in [docs/SOLUTION.md](docs/SOLUTION.md).

## Who it is for

The payment flow is an African buyer paying a South African supplier. The proposed first customer is the **South African supplier**, which publishes its payout details once, signed with its own key, and brings its buyers onto the system. This direction is proposed in [ADR 0001](docs/decisions/0001-supplier-anchored-reframe.md) and awaits team sign-off. Until it is accepted, [BUILD-BRIEF.md](BUILD-BRIEF.md) is the agreed build.

The business case, competitors, pricing assumptions and a user story are in [docs/BUSINESS.md](docs/BUSINESS.md).

## What is real and what is simulated

| Part | In the hackathon demo |
|---|---|
| Agent run on a real invoice file | Planned, real |
| Two-signature RLUSD payment on XRPL Testnet | Planned, real |
| Rule checks, holds and operator limits | Planned, real |
| Invoices, suppliers and buyers | Fictional |
| Conversion to rand and payout to a supplier's bank | **Simulated** |
| Bank account verification, accounting system links | **Simulated** |
| Customers, pilots, savings | None claimed |

## Hackathon scoring

Judges score three areas, taken from the team's BuilderBase dashboard on 9 November 2026.

| Criterion | Weight | Where the build stands today |
|---|---|---|
| Product design | 33% | Nothing to score: no screens or mockups |
| Technical UX | 34% | Nothing to score: no code, no deployment |
| Business/Market Fit | 33% | Narrative and evidence only, no customer validation |

The track requires an autonomous transaction on XRPL Testnet or Devnet, limits enforced outside the agent's control, and a way for a human operator to change them. See [docs/HACKATHON.md](docs/HACKATHON.md).

## Documents

| Read this | For |
|---|---|
| [BUILD-BRIEF.md](BUILD-BRIEF.md) | The agreed build, flow, stack and acceptance tests |
| [docs/PROBLEM.md](docs/PROBLEM.md) | Problem statement and sourced evidence |
| [docs/SOLUTION.md](docs/SOLUTION.md) | Rules, two-signature design, simpler options considered |
| [docs/BUSINESS.md](docs/BUSINESS.md) | Customer, savings, revenue, feasibility, competitors |
| [docs/ENGINEERING.md](docs/ENGINEERING.md) | Repository layout, review process, tests, security, release checks |
| [docs/HACKATHON.md](docs/HACKATHON.md) | Event facts, rubric, deadlines, what is unknown |
| [docs/decisions/](docs/decisions/) | Decision records, each marked proposed or accepted |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Source index |
| [docs/CLAUDE-PLAN.md](docs/CLAUDE-PLAN.md) | Historical plan from 5 November, kept for reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | How to work in this repository |

Where documents differ, the build brief takes precedence.

## Honest limits

- The South African rules for cross-border crypto are a draft. The August 2026 draft manual bars resident companies from cross-border crypto transactions, which is why the buyer in this design sits outside South Africa. No lawyer has reviewed this.
- A supplier wants rand, not RLUSD. That depends on a licensed payout partner that has not been contacted.
- The RLUSD issuer can freeze or claw back the asset.
- If the operator's own key is stolen, the design does not protect them.
- Nothing here is production software. Testnet only, no real funds.

## Licence

See [LICENSE](LICENSE).
