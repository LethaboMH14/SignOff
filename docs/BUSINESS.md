# The business case

Desk research and reasoning as of 9 November 2026. No customer has validated any of it. Prices and market sizes are assumptions until a real finance lead confirms them.

## User story (fictional)

Thandi is the credit controller at a Cape Town solar wholesaler. Mwila is the finance lead at a Lusaka distributor that buys from her every month.

**Today.** A fraudster emails Mwila a convincing letter saying the wholesaler's bank details have changed. Mwila is busy and pays. Thandi's invoice shows unpaid, the stock is held, and the two companies argue over who carries the loss. When Mwila does catch such emails, it is because he phones Thandi before every payment, which delays every payment.

**With SignOff.** Thandi's company publishes its payout details once, signed with its own key. Mwila's agent reads each invoice, matches it to the order and the delivery, and pays the routine ones the same day. The fraudster's email changes nothing, because the payout record did not change. A real change of details needs the wholesaler's key and a waiting period, and Mwila is told.

## Who buys

| Party | Role | Why they care |
|---|---|---|
| South African supplier (first customer, hypothesis) | Publishes signed payout details, invites its buyers | Gets paid sooner; stops losing customers to fraud done in its name |
| Buyer outside South Africa | Runs the agent and sets the limits | Pays without the phone check and cannot be redirected |

Leading with the supplier was accepted in [ADR 0001](decisions/0001-supplier-anchored-reframe.md) as a go-to-market hypothesis. The buyer initiates and controls payments; the supplier is the entry point. One wholesaler brings many buyers, which is cheaper than selling to buyers one at a time. Who buys, who pays and who authorises onboarding are not yet validated.

## How customers save money

- **Avoided loss.** One redirected payment is usually gone for good. Cases in [PROBLEM.md](PROBLEM.md) run from about R630,000 to R12m.
- **Staff time.** Routine invoices clear without a person re-checking bank details.
- **Early-payment discounts.** Paying in 10 days instead of 30 for a 2% discount is worth about 37% a year (2 ÷ 98 × 365 ÷ 20). Reliable fast payment makes the discount claimable.
- **Transfer cost.** Vendor sources put bank cross-border fees at 3–7%. Any saving depends on a licensed partner's pricing, which is unverified.

## How the company earns

- **A percentage of each protected payment, in tiers.** SignOff takes 2% to 5% of the value of each payment it protects. The percentage rises with the size of the payment. The buyer pays it. The exact tier bands are not set, and this model has not been tested with any customer.
- **Supplier-led growth.** Each supplier that publishes a payout record brings its buyers, so volume grows through supplier onboarding rather than per-buyer sales.
- **Later.** Per-verification fees, a share of captured discounts, partnerships with cyber insurers.
- **Defensibility.** The register of supplier-signed payout details grows more valuable with each supplier.

**Open risks, stated plainly.**

- A percentage of money moved can make SignOff look like a payment provider rather than software. Legal confirmation is needed before any launch.
- At 2% to 5%, a supplier comparing SignOff with a bank EFT costing a few rand will see the difference clearly. Buyers who pay large invoices may push back hardest.
- Tiers can invite splitting invoices to stay under a band. The Warden's rules are meant to catch that, but this is untested.
- No customer has agreed to any percentage. The next step is a pilot with one South African supplier and its buyers, to test what they will accept.

**Earlier model, kept for reference.** The historical plan used a flat subscription of about US$299 a month per buyer (an assumption). The model above is the owner's current choice, and it replaces that plan in this document.

## Existing solutions

| Product | What it does | Gap |
|---|---|---|
| [Eftsure Africa](https://eftsure.com/international-verifications) | Verifies payee bank details before payment, operating in South Africa | No autonomous payment |
| [Pulsify](https://www.pulsify.tech/blog/invoice-fraud-prevention-software-south-africa/) | Accounts-payable automation on Xero; compares invoice bank details with the stored contact | States it is not a bank-verified check |
| [Ramp](https://ramp.com/blog/agentic-payments) | Agent payments within limits the buyer sets | US, card rails |
| Bank account verification (AVS-R) via [RealPay](https://www.realpay.co.za/products/avs-r) and others | Confirms a South African account's holder and status | A check, not a payment control |
| XRPL agent wallet skill | Wallet for agents | Multi-signing is out of scope, per our earlier notes |

We found no product combining a ledger-enforced second signature, supplier-signed payout details and African payment rails. Eftsure's existence shows businesses pay for payee verification; SignOff's claim is verification plus safe automation.

## Feasibility

| Area | Rating | Reasoning |
|---|---|---|
| Technical, demo | High if the design is simplified | Two-signature accounts are established on the ledger. The risk is four days and no code. |
| Technical, production | Not yet | Needs a licensed payout partner, key custody and compliance work. Shown as simulated. |
| Business | Medium | Documented pain and a paying competitor. Held back by draft regulation, partner dependence and no customer conversations. |

## Impact

| Kind | Claim | Standing |
|---|---|---|
| Economic | Suppliers are paid sooner and fewer payments are lost for good | Plausible, unproven |
| Economic | Cheaper trade payments within Africa | Depends on partner pricing |
| Social | Small suppliers survive late-payment strain | Late payment is documented; our effect on it is not |
| Public sector | Government and municipal payments (R12.4bn in late invoices) | Roadmap only |

## Local infrastructure

| Integration | Purpose | In the demo |
|---|---|---|
| RLUSD partners in Africa ([Yellow Card, Chipper Cash, VALR](https://techcabal.com/2025/09/05/ripple-brings-its-rlusd-stablecoin-to-africa/)) | Convert RLUSD and pay the supplier in rand | **Simulated**; none contacted |
| Bank account verification (AVS-R) | Confirm the supplier's rand account | **Simulated** |
| Xero or Sage | Read purchase orders, write back payments | **Simulated** or fixture data |
| Rand stablecoin [ZARU](https://www.businessday.co.za/companies/2026-02-03-rand-backed-stablecoin-zaru-launched/) | Possible domestic settlement later | Roadmap |

## Regulation

**This section is a summary of public documents, not a legal conclusion. No qualified lawyer has reviewed it, and it must be reviewed before any real money moves.** Checked 10 November 2026.

South Africa's rules for moving crypto assets across the border are **not settled law**. The sequence so far, from primary sources where we have them:

| Date | Event | Source |
|---|---|---|
| 17 April 2026 | Treasury and the Reserve Bank publish **draft** Capital Flow Management Regulations, bringing cross-border crypto into exchange control | Referenced in the [SARB statement](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets) |
| 15 May 2026 | Joint media statement after industry pushback | Referenced in the [SARB statement](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets) |
| 3 August 2026 | **Draft** Crypto Assets Manual for cross-border activities published for comment until 30 September. It says that "only individuals, at this stage" may move crypto assets offshore through authorised providers, and that it remains subject to refinement. | [SARB, primary](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets) |
| 21 October 2026 | In the Medium-Term Budget Policy Statement, the Minister of Finance says Treasury received thousands of comments, needs a different approach, will move away from pre-approvals toward checking transactions for legitimacy and tax compliance, will follow Financial Stability Board recommendations, and will publish a revised second draft | [MTBPS speech, gov.za, primary](https://www.gov.za/news/budget/minister-enoch-godongwana-mtbps-speech) · [Connecting Africa](https://www.connectingafrica.com/fintech/sa-national-treasury-rethinking-crypto-regulation) |

Law-firm commentary on the August draft reads it as excluding resident companies and trusts ([Werksmans](https://werksmans.com/south-africas-crypto-crackdown-draft-manual-brings-cross-border-crypto-asset-transactions-under-exchange-control/), [Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/2026/08/south-africa-proposed-framework-for-cross-border-crypto-asset-transactions)). The second draft had not been found published as of 10 November 2026.

What this means for the design, as our reading only:

- The buyer that holds RLUSD sits outside South Africa, so the South African supplier never holds crypto. It receives rand through a licensed partner.
- The rules are moving. A revised draft could make the design easier or harder; the pitch should say so rather than predict it.
- The buyer's own country's rules (for example Zambia's) have not been reviewed at all.

## What would raise the Business score fastest

One recorded conversation with a credit controller or finance lead at a South African wholesaler, documenting how they handle bank-detail changes today and what a redirected payment has cost them.
