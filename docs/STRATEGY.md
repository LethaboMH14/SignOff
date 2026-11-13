# Strategy: decisions and research for the final submission

Written 13 November 2026, the deadline day, to answer the team's open questions in one place. Each section starts with a **decision** and then the evidence. Claims carry a state as rule R-1 requires: *Live on Testnet*, *Simulated*, *Planned*, or *Unverified* (desk research we have not checked against a primary source). No customer has been interviewed yet, so every statement about customers is a hypothesis ([CUSTOMER-DISCOVERY.md](CUSTOMER-DISCOVERY.md)). Testnet RLUSD has no real value.

Read with [PROBLEM.md](PROBLEM.md) (the evidence of the problem), [BUSINESS.md](BUSINESS.md) (who pays and why), [TRUST.md](TRUST.md) (who is trusted with what) and [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) (what real money needs).

## Decisions at a glance

| Question | Decision |
|---|---|
| Who we build for first | The finance clerk or credit controller at a supplier that sells across a border in southern Africa, and the buyer's finance lead who pays it. Hypothesis until interviews |
| The pain we solve | "Our bank details have changed" fraud, and the slow manual phone check that defends against it |
| Invoice channels | Email now (built). Next: Xero, Sage and QuickBooks; WhatsApp Business; national e-invoicing feeds (Kenya eTIMS, Nigeria's FIRS system, SARS later) |
| Warden engine | Keep the deterministic TypeScript core. Add XRPL Permission Delegation for a ledger-level transaction-type limit after it is verified on Testnet. Consider Cedar for operator-editable policy later, not now |
| When a person steps in | Never for a routine matching invoice inside limits. Always for a hold, a payee change, a limit increase, a new supplier, and anything above the per-payment limit |
| Proof of payment | Transaction hash, validated ledger index, `tesSUCCESS`, two signers, delivered amount. Anyone can check them on the public explorer; `npm run demo:verify` re-checks from the ledger |
| Rails | RLUSD on XRPL between the buyer and a licensed partner; the supplier receives local currency through that partner. Never crypto to the South African supplier |
| What we will not claim | Savings, validated customers, real payouts, production readiness |

## 1. The customer and the problem

### Pain points this build addresses

| Pain | Who feels it | How SignOff answers it | State |
|---|---|---|---|
| A fraudster emails "our bank details have changed" and the buyer pays the wrong account | Buyer loses the money; supplier loses the payment and often the customer | The destination never comes from a document or an email. Only a payout record the supplier signed, with a waiting period and a second person for any change | Live on Testnet with a test-issued token (payee checks, T-071); a real bank-detail fraud email quarantined in 9 ms with no model call, nothing paid (T-265; ATK-01) |
| A person phones the supplier before every payment, so every payment waits | Buyer's clerk; supplier's cash flow | Routine invoices that match the order, the goods receipt and the signed record are paid without a click | Live on Testnet, about 14 s from file to validated payment (T-260) |
| An AI that reads invoices can be tricked by hidden text | Anyone automating accounts payable | The model only reads fields. It cannot sign, cannot choose the payee, and an independent Warden must co-sign | Live on Testnet: single-key payments refused with `tefBAD_QUORUM` (T-054) |
| Cross-border payments are slow and costly | Both sides | RLUSD settles in seconds on XRPL. The local-currency leg depends on a partner | Ledger leg live; payout leg simulated |
| South African courts generally leave the loss with whoever paid | Buyer | Prevention matters more than recovery | Source in [PROBLEM.md](PROBLEM.md) (read the judgments before quoting) |

### Target market

**First:** South African wholesalers and distributors that sell to buyers in neighbouring countries: solar, building supplies, agricultural inputs. Each one has many repeat buyers, a known bank-detail fraud pattern (Rubicon warns its customers publicly), and payments that cross a border. One supplier brings many buyers ([ADR 0001](decisions/0001-supplier-anchored-reframe.md)).

**Then:** buyers in Zambia, Botswana, Namibia, Zimbabwe and Mozambique that pay South African suppliers, and the reverse flow. **Later:** Kenya and Nigeria, where e-invoicing is already compulsory (section 2) and stablecoin use is high (section 5).

**Not now:** consumers, payroll, and the public sector. Public-sector late payment is large (R12.4bn in invoices older than 30 days, [PROBLEM.md](PROBLEM.md)), but procurement law makes it a long sale.

### Direct to the customer, and why it gives them agency

The product is sold to the business that pays, not to its bank. That gives the customer control the current process does not:

- **The buyer sets the rules.** Limits per payment, per supplier and per day, and a pause button that works whatever the agent does. The bank does not decide; the customer's own Warden does.
- **The supplier owns its identity.** It signs its own payout record with its own key. Nobody else can change where it is paid, including the buyer's staff, an email or SignOff.
- **Every decision is explainable.** A hold says why ("the invoice says the bank details have changed"). The audit export links invoice, order, receipt, policy version and ledger hash.
- **Nobody is locked in.** The proof is on a public ledger, readable without SignOff.

### How it shortens the gap between supplier and buyer

Today a routine cross-border invoice waits for three things: a person to check it, a person to phone and confirm the bank details, and the bank transfer itself. SignOff removes the first two for routine invoices and shortens the third. Section 9 has the measured times.

**For the supplier:** paid sooner and more predictably. Customers stop being robbed in its name. Early-payment discounts become something it can offer, because payment on approval is reliable.
**For the buyer:** no phone check on routine invoices. Payments cannot be redirected by email. A limit can be lowered or everything paused in seconds.

| Country | Why it fits | What is different | State |
|---|---|---|---|
| South Africa | The launch supplier base; most African detections of email payment fraud are reported here (INTERPOL, figure to verify) | The supplier must receive rand, not crypto. Cross-border crypto rules are in draft and being rewritten ([BUSINESS.md](BUSINESS.md#regulation)) | Desk research |
| Kenya | eTIMS makes every business issue electronic tax invoices, so invoices can arrive as structured data, not PDFs. The VASP Act 2025 gives crypto service providers a licensing route | Mobile money (M-Pesa) is the usual payout rail. Stablecoin reserve rules are not yet issued | Unverified; secondary sources |
| Nigeria | Largest crypto market in Sub-Saharan Africa; stablecoins are widely used for dollar access. FIRS e-invoicing applies first to large taxpayers | The SEC treats digital assets as securities under the Investments and Securities Act 2025. FX controls are strict | Unverified; secondary sources |

### Marketplace and communities

**Decision:** do not build a marketplace now. Build the **supplier register** (the set of signed, verified payout records) as the network asset. A supplier verified once can be paid safely by every buyer that uses SignOff. That is the network effect a marketplace would give, without the two-sided cold start.

**Communities to borrow trust from** (none contacted):
- Trade associations: South African Photovoltaic Industry Association (SAPVIA), the Zambian solar and energy chambers, the Southern African Development Community (SADC) business councils.
- Finance-professional bodies: SAICA and SAIPA in South Africa, ICPAK in Kenya, ICAN in Nigeria. Accountants recommend tools to small businesses.
- The XRPL and Ripple developer community, and W3Node's own network, for technical credibility.
- Supplier-led invitations: each enrolled supplier invites its buyers. The invitation comes from someone they already trust.

Trust rule: show proof, not testimonials. The public explorer links and the attack replay are the trust material until real customers can speak.

### How this helps a fragmented ecosystem

African cross-border payments run across many currencies, banks, mobile-money systems and rules. SignOff does not try to replace any of them. It adds one layer that works the same whichever rail pays out: a verified payee, a matched invoice, and a two-signature payment with public proof. The local leg can be a bank (through a partner), mobile money, or later PAPSS. The checks do not change.

## 2. Getting invoices in: connector choices

People send invoices to companies in roughly five ways. **Decision:** email first (built), accounting systems second, WhatsApp third, national e-invoicing feeds as each country requires them.

| Channel | How invoices arrive | Fit for SignOff | Effort | State |
|---|---|---|---|---|
| Email with a PDF | The most common route for business invoices | Built: IMAP watcher, sender allow-list, Gmail's `dmarc=pass`, real-PDF check, email body never given to a model | Done | Live on Testnet: a real Gmail email paid in about 21 s (T-264) |
| Accounting system (Xero, Sage, QuickBooks) | Bills, purchase orders and goods receipts already live there | Highest value: it replaces the hand-kept evidence file with the customer's own purchase orders and receipts, and payments can be written back | 1 to 2 weeks per system | Planned (P8) |
| WhatsApp Business | Many African small businesses send invoices as photos or PDFs in chat | High reach, lower trust: needs opt-in and message templates. Treat a chat invoice like an email: the payee still comes only from the signed record | 1 week (Cloud API) | Planned |
| National e-invoicing (Kenya eTIMS, Nigeria FIRS, SARS later) | The tax authority validates the invoice and gives it an identifier | Strong evidence: an invoice the tax authority knows about is harder to forge. Use it as an extra check, not a payment authority | Per country | Unverified dates: SARS consulting, about 2028 |
| Supplier portal or upload | Supplier uploads to a buyer's portal | Built in the desk as a test sender | Done | Built; live click-through not yet run |
| Peppol | European-born network now being adopted in parts of Africa | Later; Nigeria is reportedly evaluating Peppol profiles | Later | Unverified |

## 3. The Warden: rules, engine and trust

### Is there a better engine for the Warden?

**Decision: keep the in-house deterministic TypeScript Warden for the hackathon and pilot. Add one ledger feature after verifying it, and one policy-language option later.**

| Option | What it gives | Why not now / when |
|---|---|---|
| Current Warden (TypeScript, Zod, event-sourced log) | Small, fully tested (attack suite ATK-01 to ATK-13, PIN-01 to PIN-05), every decision linked to evidence | Keep |
| **XRPL Permission Delegation** | The ledger itself limits which transaction types a delegate may sign. Today only the Warden refuses non-payments (ATK-12) | Next, once verified on Testnet. Turns a Warden promise into a ledger rule |
| Cedar (AWS's authorisation language) | Policies that can be automatically analysed for contradictions; readable by an auditor | Later, if operators need to edit rules themselves. Smaller ecosystem; JavaScript support to be checked |
| Open Policy Agent (Rego) | General policy engine with wide tooling | Heavier than needed; rules are not the hard part |
| XRPL Hooks (code on the ledger) | Rules enforced on-chain | Not on the XRPL main network; skip |
| Escrow with conditions | Funds locked until a condition is met | Useful for paying on delivery (section 6), not as the rule engine; not yet possible with RLUSD (T-217) |

The Warden's value is not the rule language. It is that the Warden is **separate**: its own key, its own process (separate hosting is P1), and its own records the agent cannot write.

### Enforcing the trust layer, and the fallbacks

| Layer | Enforced by | If it fails |
|---|---|---|
| Two signatures for every payment | XRP Ledger (quorum 2, master key disabled) | Cannot fail open: a single key is refused (`tefBAD_QUORUM`, T-054) |
| Payee, order, receipt, duplicates, limits, transaction type | Warden | Warden down → nothing is co-signed; invoices wait as proposed |
| Supplier identity and payout changes | People: two-person approval, cooling-off period, out-of-band check | Change refused or held |
| The records the Warden trusts | Separation of duties for orders, receipts and approvals | Out of the model's reach; upstream fraud is the residual risk ([TRUST.md](TRUST.md#threats-from-upstream-of-the-agent)) |

Fallbacks, all of which fail **closed** (rule R-8):
- **Model unavailable or unsure:** hold with a reason. Never pay on a partial result. (Live models failed 20 to 22 of 30 calls on the labelled set; those cases held, none paid.)
- **Ledger node down:** switch to the next node. Seen today: "a testnet endpoint did not answer; trying the next", then it connected. If all nodes fail, the Warden refuses.
- **Submission result unclear:** query until `LastLedgerSequence` passes. Never resubmit blindly ([SERVICE-LEVELS.md](SERVICE-LEVELS.md#xrpl-submission-rules-from-the-official-procedure)).
- **Key lost or stolen:** pause, abandon the account, fund a new one from the separate reserve. Loss is capped by the small working balance.
- **RLUSD line frozen by the issuer:** detected before signing; payments held (PIN-03, T-072).
- **Operator console down:** the Warden pauses itself until a separate pause route is built and tested.

### When does the human step in?

| Situation | Human action | Why |
|---|---|---|
| Routine invoice, matches order and receipt, payee unchanged, within limits | None | This is the time the product saves |
| Any hold (missing evidence, mismatch, duplicate, over limit, model abstained) | Operator reads the reason and resolves it | The machine is unsure, so it asks |
| Payout detail change | Supplier signs with its current key; a waiting period; operator confirms out of band; a second person approves | The main fraud route |
| New supplier | Enrolment checks and a second approver | Identity is the root of trust |
| Limit increase | A second approver | One stolen login must not raise the cap (seen today: with only one operator account, the second-approver flow cannot run; the demo limit was raised in the Warden's local config, logged) |
| Pause | Any operator, instantly | Safety beats speed |

### Multi-step with strict rules

The flow is a fixed graph in code, not an agent choosing its own steps: intake → screen → extract → verify quotes → match → propose → Warden checks → co-sign → submit → reconcile. Each step has a typed input and output (Zod), a named reason code for every hold, and at most three model calls per invoice. A step can only move forward if the previous step's output validated. This is what the brief calls graph engineering: every transition is logged with the evidence it used, so the audit trail is the graph.

## 4. The agent: hallucinations, security, and work before the model

### Preventing hallucinations

The design assumes the model will sometimes be wrong and makes that cause a hold, never a wrong payment ([AGENT-RELIABILITY.md](AGENT-RELIABILITY.md)):

1. **The model decides as little as possible.** It reads fields. Code matches. The Warden decides. The ledger requires two keys.
2. **Every field quotes its source text.** Code checks the quote appears in the invoice and re-parses the amount from it. A mismatch is a hold.
3. **"I don't know" is allowed.** An empty required field is a hold.
4. **Schema-enforced output.** Every response must parse, or it is a hold.
5. **The payee never comes from the model.** A hallucinated account cannot be paid.
6. **Measure it.** Report false approvals (the number that matters) with the test-set size; compare with a single-prompt baseline.

### Securing an API-driven agent

| Risk | Control in the build |
|---|---|
| Hidden instructions in an invoice or email (prompt injection) | Screen quarantines instruction-like text and payee-change claims before any model reads them; the email body never reaches a model; invoice text passed as data |
| The agent is fully hijacked | It has one write action (propose a payment) and no key that can pay alone |
| Stolen API or model keys | Keys live in a local `.env` outside the repository; staged secret scan on every commit. Production: a key vault (P2) |
| Agent calls the Warden with altered terms | The Warden signs only terms it checked; altered amounts refused (PIN-04) |
| Replay or duplicate requests | Stable obligation identity per payable; five concurrent requests → one payment (ATK-06) |
| Model provider outage or rate limit | Retry with backoff, then hold |
| Model provider sees sensitive data | Only invoice text goes to the model; no keys, no bank records ([ADR 0006](decisions/0006-model-boundary-and-providers.md)) |

### What optimises the work before the model

Most of the reliability comes from deterministic work done before and after the model call:
- **Admission:** sender allow-list, DMARC pass, real-PDF check by file signature, size and count limits, file named by its hash.
- **Text extraction in code**, not by the model, from text PDFs.
- **Screening:** instruction-like text and bank-change claims quarantined with no model call. This is cheaper and safer than asking a model whether it is being attacked.
- **Bounded context:** the model sees one invoice and the field schema, nothing else.
- **Fingerprinting:** the document hash links the invoice to its order evidence, so a re-saved or altered PDF is held.
- **Later:** structured e-invoices (eTIMS, Peppol) remove the need for the model on those invoices entirely.

### Agent advantages and disadvantages

| Advantages | Disadvantages, and our answer |
|---|---|
| Works every invoice in seconds, around the clock | Can be wrong → every error becomes a hold |
| Reads varied invoice layouts without a template per supplier | Can be tricked by document text → screen first; no power to pay or choose the payee |
| Explains each field with its source | Model calls fail (20 to 22 of 30 on the labelled set) → a hold is safe but slow; P7 is the fix |
| Cheap per invoice | Depends on outside providers → four providers supported; fixture mode labelled |
| Frees finance staff for exceptions | Staff may over-trust it → holds are explained, and nothing pays without the Warden |

## 5. Rails: Ripple, stablecoins and banks in Africa

### Ripple's reach in Africa

- **RLUSD distribution** began in Africa through Chipper Cash, VALR and Yellow Card (announced September 2025, [TechCabal](https://techcabal.com/2025/09/05/ripple-brings-its-rlusd-stablecoin-to-africa/)). These are the candidate payout partners. None has been contacted.
- **Absa and Ripple** announced institutional digital-asset custody for South Africa on 15 October 2025 ([Ripple](https://ripple.com/ripple-press/ripple-expands-global-custody-footprint-into-africa-with-absa-bank/), [Absa CIB](https://cib.absa.africa/home/insights-and-events/absa-bank-partners-with-ripple-to-expand-digital-asset-custody-offering-in-south-africa/)). A report that it went live in September 2026 has a single source ([CoinGape](https://coingape.com/south-africas-absa-cib-rolls-out-bank-backed-crypto-custody-powered-by-ripple/)): unverified.
- **Usability by region**, our reading: southern Africa has the bank link (Absa) and exchanges (VALR); East Africa has mobile-money payouts via Yellow Card and Chipper; West Africa (Nigeria) has the most users but the strictest FX and securities rules. Every corridor needs a partner's own confirmation.

### Stablecoin research

- Stablecoins were about **43% of Sub-Saharan Africa's crypto transaction volume** in the year to June 2025, driven by currency weakness and dollar shortages (Chainalysis, via [Cointelegraph](https://cointelegraph.com/news/currency-devaluation-drives-stablecoin-adoption-sub-saharan-africa)). Nigeria received about US$92bn on-chain, the most in the region ([tech.africa](https://tech.africa/sub-saharan-africa-crypto-205bn/)). Secondary sources: verify in the Chainalysis report before quoting.
- **RLUSD** is issued by Standard Custody & Trust Company under a New York (NYDFS) trust charter, backed by reserves with monthly independent attestations ([Ripple transparency](https://ripple.com/products/stablecoin/transparency/)). The issuer can freeze tokens to meet legal demands ([RESEARCH.md](RESEARCH.md)); the Warden checks for a frozen line before signing.
- **Rand stablecoin ZARU** launched in February 2026 ([Business Day](https://www.businessday.co.za/companies/2026-02-03-rand-backed-stablecoin-zaru-launched/)): a possible later domestic leg.

### Problems traders may meet with stablecoins

| Problem | Effect on a trader | Mitigation |
|---|---|---|
| Off-ramp to local currency | Partner fees and spreads; partner limits and due diligence | Partner chosen per corridor; supplier receives local currency, never crypto |
| Regulation changing (South Africa redrafting, Kenya's rules not finished, Nigeria treats stablecoins as securities) | A legal flow today may change | Counsel per country before real money (X1); buyer holds the stablecoin, not the South African supplier |
| Issuer freeze or loss of peg | Funds stuck or worth less | Small working balance; issuer attestation checks; freeze detected before signing |
| Accounting and tax treatment | Unclear for businesses holding stablecoins | Hold them only for minutes in the payment path; local currency on both ends |
| Travel rule and sanctions | Partner must collect sender and receiver information | Partner's job; SignOff supplies the verified supplier record |
| Wrong network or wrong issuer | Lost or unusable tokens | The Warden checks the exact issuer and asset (ATK-13) |

### Can this work with African banks?

Yes, as a layer over them, not a replacement:
- **Bank account verification** (AVS-R in South Africa) is the right check at supplier enrolment (P9).
- **Banks as custodians and partners:** Absa's Ripple custody shows a South African bank willing to hold digital assets for institutions.
- **PAPSS** (the Pan-African Payment and Settlement System, run with Afreximbank) settles in local currencies across about 28 to 31 countries in 2026; figures vary by source ([PAPSS](https://papss.com/media/beac-joins-papss-connecting-payments-between-cemac-and-the-rest-of-africa/)). It is a possible future payout rail. SignOff's checks would sit in front of it unchanged.
- Banks are also the most likely future **distribution partner**: a bank could offer SignOff's checks to its business customers.

### Interoperability

| Interface | Standard | State |
|---|---|---|
| Ledger | XRPL; RLUSD also exists on Ethereum | Live on Testnet (XRPL) |
| Proof | Public transaction hash; any explorer | Live |
| Invoices | PDF today; e-invoicing standards (eTIMS, Peppol) next | PDF live |
| Accounting | Xero and Sage APIs | Planned |
| Identity | XRPL Credentials on the supplier's account | Credential lifecycle live between test accounts (T-118); on supplier accounts in the demo |
| FX rate | x402 paid API call for the live rate | Built on this branch (`scripts/fx`) |
| Payout | Partner API; later PAPSS or mobile money | Simulated |

## 6. Web3 products: what we use and what else we could use

| Product | Used for | State |
|---|---|---|
| XRPL multi-signing (signer list, quorum 2, master key disabled) | Two keys for every payment | Live on Testnet |
| RLUSD (Testnet) | The settlement asset | Live on Testnet |
| XRPL Credentials | Marks a verified supplier's account | Live on Testnet (T-118, T-257) |
| x402 | Pays for the live FX rate per call | Built |
| XRPL Testnet faucet and explorer | Funding and public proof | Used |

| Could use | What it would add | When |
|---|---|---|
| Permission Delegation | Ledger-enforced limit on transaction types | Next, after Testnet verification. Free |
| Escrow (time or condition) | Pay on delivery: funds locked until the goods receipt is confirmed. A strong story for cross-border trade, where neither side wants to go first | After the deadline. **Not available for RLUSD today:** the issuer has not enabled trust-line locking (flag re-read on Testnet on 12 Nov, T-217), so escrow would need XRP or another token |
| Permissioned Domains | Only credentialed parties can trade in a domain | Later |
| Batch transactions | Pay several invoices atomically | Later, for payment runs |
| Multi-Purpose Tokens (MPT) | Tokenised invoices (below) | Later, research |
| Payment channels | Many small payments off-ledger, settled once | Not needed for invoices |

### What is tokenisation?

Tokenisation means representing a real-world asset or claim as a token on a ledger, so it can be held, transferred and checked by anyone the ledger allows. RLUSD is itself a tokenised dollar claim. For SignOff the interesting future use is a **tokenised invoice**: an approved, unpaid invoice as a token that a financier could buy at a discount (invoice financing). That would help close Africa's trade-finance gap, estimated by Afreximbank at about US$100bn a year (secondary source, verify). Roadmap only; it raises securities questions in several countries.

## 7. Regulators, policymakers and incumbents

| Country or region | Regulators and policymakers | Why they matter |
|---|---|---|
| South Africa | South African Reserve Bank (exchange control, payments), Financial Sector Conduct Authority (crypto asset providers), Financial Intelligence Centre (travel rule, Directive 9), National Treasury, the Intergovernmental Fintech Working Group, the Information Regulator (POPIA), SARS (e-invoicing) | Rules for cross-border crypto are being redrafted after the October 2026 budget statement |
| Kenya | Central Bank of Kenya (stablecoins, custodians), Capital Markets Authority (exchanges), Kenya Revenue Authority (eTIMS) | VASP Act 2025; stablecoin regulations pending |
| Nigeria | Central Bank of Nigeria (FX, payments), Securities and Exchange Commission (digital assets), FIRS (e-invoicing) | Stablecoins treated as securities |
| Zambia (first buyer country) | Bank of Zambia, Securities and Exchange Commission of Zambia | Not yet reviewed at all |
| Continental | AfCFTA Secretariat, Afreximbank (PAPSS), SADC | Intra-African trade policy and payment rails |

**Incumbents:** the large banks (Standard Bank, Absa, FNB, Nedbank, Equity, Ecobank), SWIFT, card and payout networks, mobile money (M-Pesa, MTN MoMo), fintech payout firms (Flutterwave, Onafriq, Chipper Cash, Yellow Card), and accounts-payable and verification tools (Eftsure, Pulsify, bank AVS). Most are potential partners rather than competitors: SignOff is the check before the payment, not the rail.

## 8. Fraud: how someone could game SignOff, and what stops them

### Fraud check statistics we can stand behind

| Measure | Result | Scope | State |
|---|---|---|---|
| Attack suite | 13 attack cases and 5 repair pins, all held, refused or rejected as expected | In-memory ledger, service layer; not live XRPL | Built and tested in software |
| Single-key payment | Refused by the ledger with `tefBAD_QUORUM`, both keys tried alone | Testnet | Live (T-054) |
| Warden holds on a test token | Duplicates, payee, receipt, limit, concurrency, pause, lowered limit, non-payment co-signature | Testnet, TST token | Live (T-071) |
| Labelled set, agent pipeline against a single-prompt baseline | Pipeline: 2 of 40 should-hold cases passed as eligible (5.0%, 95% CI 1.4% to 16.5%), 1 of 22 clean invoices held, 59 of 62 decisions right. Baseline: 32 of 40 false approvals. The Warden's own checks come after this step | 62 fictional invoices, FIXTURE stand-ins, no model called ([fixture report](../apps/agent/results/fixture-eval.md)) | Simulated. The earlier 30-case run had none (T-116) |
| Live models on the labelled set | Model call failed on 20 to 22 of 30 cases; all of those held, none paid | One run per provider | Measured on a separate branch; not merged |
| Today's email tests | One real email invoice held `OVER_LIMIT`, nothing paid; after the limit was raised, the next was paid once with two signers; a real "our bank details have changed" email was quarantined before any model read it, nothing paid | Three invoices (T-264, T-265) | Live mailbox; payments on Testnet |

Never present these as "zero risk" (rule R-5). They are small, fictional test sets.

### Ways to game the system

| Attack | What the attacker tries | What stops it | Residual risk |
|---|---|---|---|
| Fake "new bank details" email | Redirect payment | Payee only from the signed record; email body never read by a model; claim quarantined | Low |
| Compromise the supplier's real mailbox | Send a forged invoice that passes the allow-list and DMARC | DMARC proves the domain, not the honesty; the invoice must still match a real order and goods receipt, and the payee cannot change | Medium if paired with a fake order |
| Steal the supplier's signing key | Sign a payout change | Cooling-off period, out-of-band confirmation, second approver (ATK-03) | Low to medium |
| Split one large fraud into many small invoices under the limit | Stay below per-payment checks | Per-supplier and total daily limits (seen today: the fifth payment of the day was held) | Medium: needs anomaly alerts (P4) |
| Re-send an invoice with a tweaked number | Get paid twice | Stable obligation identity and duplicate checks (ATK-05, ATK-06); the order must have open value | Check that partly-paid orders are tracked (to verify) |
| Insider creates a fake order and fake receipt | A consistent but fraudulent invoice | Separation of duties for orders, receipts and approvals; audit trail | Highest: this is a process risk, not a model one |
| Hidden text in the PDF tells the model to approve | Prompt injection | Screen first; the model cannot approve or choose a payee | Low |
| Take over the operator login | Raise limits, approve a supplier | Step-up password, second approver for increases, sign-in throttling; MFA in production (P5) | Medium until MFA |
| Steal both Agent and Warden keys | Pay anything | Separate hosts (P1), key vault (P2); loss capped by the working balance | Low probability, capped impact |
| Wrong issuer or fake "RLUSD" | Pay with a worthless token | Exact issuer check (ATK-13) | Low |

### Preparing for it

Before real money: separate hosting and key vault (P1, P2), alerts on unusual patterns (P4), MFA (P5), real bank account verification (P9), an independent security review (X4), and a capped pilot. Then measure false approvals and false holds on the customer's own invoices.

## 9. How fast compared with the traditional method

| Step | SignOff (measured) | Traditional (sourced or estimated) |
|---|---|---|
| Invoice file to validated payment | **About 14 s**: received 06:54:01.99 UTC, reconciled as paid 06:54:16.21 UTC (T-260, agent log) | Days to weeks: manual capture, approval, payment run. Typical payment terms are 30 days or more. *Estimate, unverified for our customers* |
| Model reading the invoice | 1.3 s in that run | A clerk keying the invoice: minutes |
| Bank-detail confirmation | None needed for an unchanged signed record | A phone call, often a day's wait. *Fictional example in our discovery pack; to be measured in interviews* |
| Ledger settlement | About 9.4 s from submission to reconciled (T-260) | SWIFT: about 25% of payments to Africa fully credited within an hour, a further 52% within 24 hours (Swift data 2021–2025, via [Finextra](https://www.finextra.com/blogposting/27731/accelerating-africa-the-power-of-global-standards-to-transform-cross-border-payments)) |
| Email sent to validated, reconciled payment | **About 21 s**: sent 12:27:40, accepted by the watcher 12:27:45.5, reconciled as paid 12:28:00.8 UTC, hash `97B98184…C2B6` (T-264). An earlier email took about 41 s to a decision with the old watcher | Email, manual capture, phone check and bank transfer: days |
| Cost | XRPL fees are fractions of a cent; the payout partner's fee is unknown | Sending US$200 to Sub-Saharan Africa costs about 8.46% on average (World Bank, Q3 2025, via [African Exponent](https://www.africanexponent.com/chart-of-the-day-sending-200-home-to-sub-saharan-africa-costs-8-46-percent/)). That is remittances, not business payments: indicative only |

**Not measured:** the local-currency payout leg (simulated), so the supplier's real time to receive funds is not yet known. Say "settles on the ledger in seconds", not "the supplier is paid in seconds".

## 10. Making the delivery memorable

- **Show the attack live.** Email a real fraudulent "bank details changed" invoice during the pitch and let the judges watch it stop at the hold lane. Then email the clean one and open the explorer link.
- **Let the judges verify it.** A QR code on the last slide that opens the transaction hash on the public explorer. Anyone can check it without trusting us.
- **One human story.** Thandi and Mwila from [BUSINESS.md](BUSINESS.md): one fictional supplier, one buyer, one fraud email.
- **The pause.** Press pause on the console (or the Arduino switch, a stretch goal) and show the next invoice held.
- **Honest labels on screen.** "Testnet, no real value" and "payout simulated" shown proudly. It builds trust with technical judges.

## 11. What to ask W3Node, the sponsors and partners

| From | Ask |
|---|---|
| Ripple and the XRPL ecosystem | Introductions to the RLUSD partners in Africa (Yellow Card, VALR, Chipper Cash) for a business payout pilot; confirmation of Permission Delegation on Testnet; mentorship on RLUSD compliance for business flows |
| W3Node and the hackathon organisers | Introductions to finance leads at African wholesalers for interviews; a pilot slot at a future event; feedback from judges on the business model |
| Banks (Absa and others) | A conversation on custody and bank-account verification for supplier enrolment |
| Legal partners | Pro bono or reduced-fee opinion on South African and Zambian rules (X1) |
| Security partners | An independent review of the Warden (X4) |
| Cloud sponsors | Credits to host the Warden separately from the agent (P1) and use a key vault (P2) |

## 12. Build for the customer first

The advice is to build for the customer. The repository is ahead of the customer evidence: the engineering is live on Testnet, but **no finance lead has confirmed the problem**. The next hours are best spent on [CUSTOMER-DISCOVERY.md](CUSTOMER-DISCOVERY.md): one recorded conversation with a credit controller at a South African wholesaler. Listen for the last time someone said their bank details had changed, what they did, how long it took, and what it cost.

The problem in one line, to keep in front of every decision: **paying a supplier is the one finance step businesses will not automate, because a wrong payment is usually irreversible and the loss usually stays with the payer.**

## Sources added today

- Chainalysis 2025 regional figures, via [Cointelegraph](https://cointelegraph.com/news/currency-devaluation-drives-stablecoin-adoption-sub-saharan-africa) and [tech.africa](https://tech.africa/sub-saharan-africa-crypto-205bn/)
- PAPSS coverage, [PAPSS](https://papss.com/media/beac-joins-papss-connecting-payments-between-cemac-and-the-rest-of-africa/) and [TechEconomy](https://techeconomy.ng/papss-targets-accelerated-adoption-transaction-growth-as-network-expands-across-africa)
- Ripple and Absa, [Ripple](https://ripple.com/ripple-press/ripple-expands-global-custody-footprint-into-africa-with-absa-bank/), [Absa CIB](https://cib.absa.africa/home/insights-and-events/absa-bank-partners-with-ripple-to-expand-digital-asset-custody-offering-in-south-africa/), [CoinGape](https://coingape.com/south-africas-absa-cib-rolls-out-bank-backed-crypto-custody-powered-by-ripple/) (single source for go-live)
- E-invoicing in Africa, [Sovos](https://sovos.com/blog/vat/e-invoicing-africa/), [VATCalc on SARS](https://www.vatcalc.com/south-africa/south-africa-vat-e-invoicing-digital-reporting-consultation/), [Interswitch on Kenya](https://interswitchgroup.com/news/newsletters/update/how-e-invoicing-is-changing-tax-administration-in-kenya) (vendor sources; confirm with the tax authorities)
- Policy engines, [Permit.io](https://permit.io/blog/policy-engine-showdown-opa-vs-openfga-vs-cedar), [Styra](https://www.styra.com/?p=44382) (vendor sources)
- African crypto regulation, [Webber Wentzel](https://webberwentzel.com/News/Pages/virtual-assets-regulation-in-east-and-west-africa.aspx), [TechCabal on Kenya's VASP bill](https://techcabal.com/2025/10/03/kenya-vasp-bill-passes-assembly-stage/), [African Business](https://african.business/2025/11/technology-information/africa-gets-to-grips-with-crypto-as-kenya-and-ghana-legislate)
- Intra-African trade, Afreximbank via [Arise](https://www.arise.tv/intra-african-trade-rises-5-5-to-213-8bn-in-2025-says-afreximbank/) and [The Star](https://www.the-star.co.ke/business/kenya/2025-06-27-pan-african-trade-up-124-in-2024-but-more-need-to-be-done-afreximbank)
- SWIFT speed to Africa, [Finextra](https://www.finextra.com/blogposting/27731/accelerating-africa-the-power-of-global-standards-to-transform-cross-border-payments), [Swift](https://www.swift.com/news-events/news/insights-african-payments-landscape-0)
- Remittance cost, [African Exponent](https://www.africanexponent.com/chart-of-the-day-sending-200-home-to-sub-saharan-africa-costs-8-46-percent/), [World Bank RPW](https://remittanceprices.worldbank.org/sites/default/files/rpw_main_report_and_annex_q423_final.pdf)
- WhatsApp invoicing in Africa, [Curacel](https://www.curacel.co/post/africa-b2b-payments-invoicing-gap), [TechCabal](https://techcabal.com/2026/04/14/chat-pay/) (indicative; no hard adoption figure found)
- RLUSD reserves and charter, [Ripple transparency](https://ripple.com/products/stablecoin/transparency/)
