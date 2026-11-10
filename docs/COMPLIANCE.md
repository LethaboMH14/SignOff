# Compliance plan

**Not legal advice. No qualified lawyer has reviewed this.** It lists the obligations we have found, who would carry each one, and what the hackathon build does about it. The hackathon demo uses fictional data and no real funds on XRPL Testnet. That does not by itself show that no rule applies: processing real personal information, the way the business is run, and each operator's legal status can all create obligations. Whether and how these rules apply must be assessed with counsel. The point here is to design so a real pilot could meet them.

Checked 10 November 2026. Regulation is described in [BUSINESS.md](BUSINESS.md#regulation).

## Who carries which obligation

SignOff is planned as software, not a money service. The table shows where obligations are **expected** to sit. This is an assumption, not a conclusion: co-signing, custody-like control and acting on a buyer's behalf may create obligations for SignOff itself, and need independent regulatory analysis.

| Party | Role | Main obligations |
|---|---|---|
| Buyer (outside South Africa) | Owns the spending account, initiates payments | Its own country's rules; its own AML and tax duties |
| Licensed payout partner (crypto asset service provider) | Converts RLUSD and pays the supplier in rand | Customer due diligence, travel rule, reporting, exchange control |
| South African supplier | Receives rand | Ordinary banking and tax; never holds crypto in this design |
| RLUSD issuer | Issues the stablecoin | Can freeze or claw back RLUSD under its own compliance policy |
| SignOff (software) | Prepares, checks and co-signs payments | Data protection; record keeping; passing required data to the partner; legal review of whether it is itself regulated |

Whether SignOff's co-signing makes it a regulated party is an **open legal question** for counsel.

## Obligations and what the design does

| Obligation | Source | Design response | In the hackathon build |
|---|---|---|---|
| **Travel rule:** originator and beneficiary details travel with crypto transfers involving a South African provider | FIC Directive 9, effective 30 April 2025 ([Acts Online](https://acts.co.za/news/blog/2026/03/fic-crypto-travel-rule-draft-guidance), [Moonstone](https://www.moonstone.co.za/fic-tightens-crypto-asset-compliance-with-travel-rule-directive/)) | SignOff records originator (buyer) and beneficiary (supplier) details per payment and hands them to the partner through its interface. Never on the ledger. | **Simulated:** the record is produced; no partner receives it |
| **Customer due diligence** on buyers and suppliers | FIC Act, via the partner | Supplier enrolment already verifies identity and bank account ([TRUST.md](TRUST.md#supplier-enrolment)); buyer onboarding records the business and authorised operators | Identity check **simulated** |
| **Sanctions screening** of parties and destination accounts | Partner obligation; RLUSD issuer freezes sanctioned addresses | Screening step before a supplier is approved and before each payment; a positive or unavailable result is a hold | **Simulated** screening service with a test list |
| **Cross-border crypto rules** | Draft manual (August 2026); revised draft announced 21 October 2026 | South African party never holds crypto; buyer outside South Africa | Design only |
| **Personal information protection** | POPIA ([Information Regulator](https://inforegulator.org.za/knowledge-base/category/popia/chapter-3-conditions-for-lawful-processing/part-a-processing-of-personal-information-in-general/condition-7-security-safeguards/)) | Collect only what payment and compliance need; encrypt at rest; role-based access; no personal or bank data in model prompts beyond the invoice being read; redact logs | Fictional data only; redaction tested |
| **Nothing personal on a public ledger** | POPIA; ledger is permanent and public | Memos carry hashes only; credentials carry no personal data | Enforced by Warden; tested |
| **Record keeping** | FIC Act requires records for at least five years (per the draft manual's provider rules) | Exportable audit trail: document hash, extracted fields with sources, policy version, model and prompt version, every decision, operator actions, ledger hash | Audit export built |
| **Crypto reporting to tax authority** | CARF data to SARS from 1 March 2026 (secondhand) | Partner obligation; SignOff's records support it | Not in scope |
| **Issuer freeze or clawback of RLUSD** | Issuer policy; clawback enabled on the ledger | Pre-signing ledger read detects a frozen trust line or unexpected balance; all payments from that account hold and the operator is alerted | Tested if Testnet allows simulating it |
| **AI governance and human oversight** | NIST AI Risk Management Framework (voluntary) | Model proposes only; human sets policy, approves exceptions and can pause; every decision explained; evaluation published | Built |

## Compliance on the ledger itself

| Control | XRPL feature | Status |
|---|---|---|
| No single party can move funds | Multi-signing | Core; to be tested ([ADR 0004](decisions/0004-workshop-adjustments.md)) |
| Public evidence that a supplier account was verified | Credentials | Stretch; attestation only |
| Only verified parties can hold a token | Trust line authorisation, set by an issuer | Not ours to set for RLUSD; noted |
| Accept top-ups only from the reserve | **Warden and funding-operator policy**, not a ledger rule | Deposit authorisation on its own does not create a reserve-only allowlist. Treat as a policy until an account control is demonstrated on Testnet |

## What we will not claim

- That SignOff is compliant with any law. It is designed with these obligations in view.
- That simulated screening, identity checks or travel-rule hand-offs are real.
- That the draft South African rules permit the design. They are drafts and are being revised.

## Before any real money

1. Legal opinion in South Africa and the buyer's country, including whether SignOff itself is regulated.
2. A signed agreement with a licensed payout partner covering due diligence, travel rule and sanctions.
3. A real screening provider.
4. An information-security review and a POPIA impact assessment.
