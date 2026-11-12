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
| **Personal information protection** | POPIA ([Information Regulator](https://inforegulator.org.za/knowledge-base/category/popia/chapter-3-conditions-for-lawful-processing/part-a-processing-of-personal-information-in-general/condition-7-security-safeguards/)) | Collect only what payment and compliance need; encrypt at rest; role-based access; no personal or bank data in model prompts beyond the invoice being read; redact logs | Fictional data only. Logs redact personal identifiers and sensitive fields (F5, tested: T-033 to T-036, T-039 to T-041). Prompts and storage are not yet built. |
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

## Lane H status: what is real, what is limited by access, what is for counsel

Checked 12 November 2026. **Not certified** against COSO, SOC 2 or any other framework; the mapping below is a labelled style, not an audit.

### Real (built and tested)

| Control | Evidence | Limit |
|---|---|---|
| Sanctions screening of the supplier legal name against the OFAC SDN list | `apps/warden/src/checks/sanctions.ts`, `apps/warden/test/sanctions.test.ts`; cache of 19,563 entries retrieved 2026-11-12, sha256 `7f43332d…` | Name matching only, no date-of-birth or address data. Hits and near-hits are held for a person. The Warden does not yet call this check (see SECURITY-MODEL section 7) |
| Sender-domain exact match and SPF, DMARC, DKIM reads | `apps/warden/src/checks/sender.ts`, `apps/warden/test/sender.test.ts` | DKIM is checked only when a selector is known. DMARC alone is not accepted as proof (a lookalike with its own DMARC is held) |
| SARS fields and VAT checks | `apps/agent/src/match/sars.ts` (lane C, D-104) | Not called from the pipeline; the mandatory-field lists are unverified |
| Log redaction of secrets and personal identifiers | `packages/shared/test/logging/redact.test.ts` | Tests cover the listed patterns only |
| Dev-only fields closed unless a flag is set | `apps/warden/src/dev-fields.ts`, `apps/warden/test/dev-fields.test.ts` | No dev-only field exists in the Warden or console yet; the gate is a tested helper |
| Kill-switch over HTTP: pause holds payments, STOP closes the listener | `apps/warden/test/server.test.ts`, "kill-switch drill" | Runs the real HTTP server in one test process with a simulated ledger, not the separate Warden process on Testnet |

### Limited by access (cannot be shown here)

- **AVS (account verification):** no bank verification service is connected. The supplier bank-change call-back is an operator process, not an automated check.
- **CIPC (South Africa company register) and PACRA (Zambia):** no access to a register lookup. Supplier identity is entered, not verified.
- **Licensed off-ramp:** no licensed crypto asset service provider is contracted. Nothing converts RLUSD to rand.
- **Live sanctions service:** OpenSanctions was assessed. Its free default dataset is licensed CC BY-NC 4.0 and its screening licence is "Internal use only", so it is not used. OFAC data is the source.
- **Live DNS from the build machine:** the system resolver refused connections; the test with DNS-over-HTTPS is a different resolver path.

### For counsel (not claimed)

- SA exchange control: the draft crypto manual (August 2026) and its revision announced 21 October 2026.
- Zambia registration and the Data Protection Act.
- The travel rule and VASP position for any licensed partner.
- Whether SignOff, as co-signer, is itself a regulated party.
- POPIA impact assessment and information-security review before any real personal data.

### OFAC terms

The OFAC sanctions-list-service and FAQ pages were read on 12 November 2026. They do not state copyright, public-domain status, fees or permitted use of the downloadable SDN list. The sanctions-list-service page says: "Published by OFAC, the SDN list contains the names of individuals, entities and groups designated by OFAC...". The Treasury footer links to a "Privacy Policy" and "Policies and Notices" page, which was not read. **Counsel must confirm the reuse terms of the SDN file before any production use.**

### Control mapping (style only, not certified)

| Area | COSO 2013 principle (example) | SOC 2 criterion (example) | Where in this repo |
|---|---|---|---|
| Segregation of duties | Control activities (10) | CC5.2 | GOVERNANCE.md section 1 |
| Change control | Control activities (11) | CC8.1 | GOVERNANCE.md section 2 |
| Sanctions and sender screening | Risk assessment (7) | CC3.2 | This file, real table |
| Logging and retention | Information and communication (13) | CC7.2 | GOVERNANCE.md section 5 |
| Incident response | Control activities (12) | CC7.4 | GOVERNANCE.md section 6 |
