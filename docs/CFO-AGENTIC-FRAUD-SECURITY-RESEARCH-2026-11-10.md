# SignOff: CFO-readiness, fraud controls and trustworthy agentic payments

**Independent engineering and product research — 10 November 2026**  
**Related:** [PR #2](https://github.com/LethaboMH14/SignOff/pull/2) · [BUILD-BRIEF](../BUILD-BRIEF.md) · [TRUST](TRUST.md) · [AGENT-RELIABILITY](AGENT-RELIABILITY.md) · [ADR 0004](decisions/0004-workshop-adjustments.md)

> **Status:** Research, specifications and test proposals only. SignOff currently has no implemented payment application, validated XRPL Testnet transfer, operating bank/FX integration or interviewed customer. None of the following is evidence that a safeguard has been implemented or tested. Example metrics and thresholds are illustrative, not measured.

## 1. Decision summary

**Accept PR #2's research direction, subject to precise corrections before its claims become authoritative.** The model should propose a payment; independent code and finance policies should authorize it; XRPL should cryptographically enforce whichever permissions have *actually been demonstrated*; a reconciler should decide whether settlement occurred. Do not let more XRPL features delay one complete demonstrable payment.

**The critical failure mode is not just hallucination.** Fraud can originate upstream: a compromised vendor master, fraudulent purchase order or goods receipt, insider collusion, stolen operator session, fake onboarding, incorrect credential issuance, key compromise, or inconsistent settlement state. A perfectly extracting model can still propose a fraudulent but internally consistent invoice. Treat *provenance and authority* separately from *OCR/extraction quality*.

The immediate delivery order is: (1) real RLUSD Testnet multisign payment and single-signer rejection, (2) verified payee and three-way match, (3) independently configured Warden, (4) duplicate/idempotent state, (5) exception desk and operator pause/limit changes, (6) validated-ledger reconciliation plus evidence export, (7) adversarial tests, (8) optional credentials/delegation/escrow/batch only if independently confirmed.

## 2. Four important corrections to PR #2 and ADR 0004

| Claim appearing in PR #2 | Correct interpretation | Required edit / test |
|---|---|---|
| “RLUSD trust line limit caps what the account can ever hold/lose” | An XRPL trust-line limit ordinarily restricts how much an account is willing to receive from a counterparty. Its *own actions* can take the balance over the limit. It is **not** a per-day, cumulative outflow, or maximum-loss limit. | Remove “hard loss cap” and “ever hold.” Keep a low pre-funded balance, separate treasury reserve, Warden's per-payment/vendor/day caps, governance of TrustSet and signer-policy changes, and measure actual spendable exposure. Test exact limits, changes and non-payment transactions. |
| “Permission delegation is not live / Devnet only” | Workshop notes are an historical account, not authoritative current network capability. XRPL's current [known amendments](https://xrpl.org/resources/known-amendments) reference \`PermissionDelegationV1_1\`; a Mainnet activation has been reported in October 2026. **Check the actual target Testnet node and transaction behavior** before declaring availability or absence. | Keep permission delegation outside the MVP critical path *regardless*. Update WORKSHOP, README and ADR 0004 to distinguish “workshop said,” current Mainnet status, target Testnet observation and unverified combinations. |
| “XRPL Credential verifies a supplier” | A credential attests that a specified issuer made a statement about a subject. It is not itself an independent KYB, bank-name match or authorization to pay. Without explicit permissioned logic, the ledger does not prohibit a payment to an uncredentialed account. | Independently establish supplier legal identity, payout control, key ownership and operator approval. When used, check credential issuer, subject, type, acceptance, expiry and revocation immediately before signing. Test issuance/acceptance/revocation. |
| “Simulate before signing means the payment will succeed” | \`simulate\` is a preflight and ledger state may change. It does not settle funds. | Ensure simulation and Warden decision bind to identical transaction fields, sign exact final bytes, persist sequence/ID/expiry, submit, then reconcile a **validated** transaction with expected delivered amount. Handle timeout/restart safely. |

Sources: [XRPL Trust Line Tokens](https://xrpl.org/docs/concepts/tokens/fungible-tokens/trust-line-tokens), [Known Amendments](https://xrpl.org/resources/known-amendments), [Permission Delegation](https://xrpl.org/docs/concepts/accounts/permission-delegation), [Credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials), [Reliable Transaction Submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission), [XRPL transaction simulation](https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/transaction-methods/simulate).

**Additional signer caveat:** “No one key can spend” is true only if *every actually usable signing path* requires a quorum greater than one key's assigned weight, and there is no live master, regular or recovery key capable of bypassing that policy. The current design mentions an offline operator recovery path. Explicitly document and test it, including its ability to change the signer list. Avoid an absolute security slogan until the actual account configuration and recovery matrix are verified. See [XRPL multisigning](https://xrpl.org/docs/concepts/accounts/multi-signing) and [SignerList](https://xrpl.org/docs/references/protocol/ledger-data/ledger-entry-types/signerlist).

## 3. What a CFO and real finance team would ask for

This is a **requirements backlog**, not a claim of customer validation. “P0” means MVP-critical or a hard precondition to payment, “P1” means important for a credible pilot, and “P2” means broader production capability.

| # | Priority / persona | Real-world need | Acceptance evidence | Example failure / hold |
|---|---|---|---|---|
| 1 | **P0 — CFO / AP** | Supplier identity and beneficiary onboarding with legal-entity and bank-destination verification | Independent KYB/AVS evidence ID, timestamp, reviewer and approved vendor-master version | Self-submitted “verified” bank account without callback |
| 2 | **P0 — AP / controller** | Bank-detail changes require out-of-band reconfirmation and cooling-off | Old and new values, verified pre-existing contact, second approver, mandatory hold interval | Fraudster emails “urgent new account” |
| 3 | **P0 — AP** | Invoice, purchase order and goods receipt three-way match | Line-level quantities, unit prices, totals, currency, tax and stated tolerances traced to source records | Correct-looking invoice for undelivered goods |
| 4 | **P0 — controller** | Detect exact and near-duplicate payments | Stable vendor + invoice identity, normalized document fingerprint, conflict search and atomic idempotency | Same invoice reuploaded or renumbered |
| 5 | **P0 — CFO / controller** | Maker-checker separation for vendor, payee and limit changes | Distinct authorized requestor and approver identities with audit events | Finance operator approves their own new account |
| 6 | **P0 — treasury** | Limits by transaction, supplier, period, token and payment rail | Warden independent policy version; tests of exceeded and *lowered* limits | Agent splits one bill into many smaller payments |
| 7 | **P0 — treasury** | Separate working wallet and treasury reserve | Balances and authorized top-ups visible; spend wallet cannot reach reserve keys | Full company liquidity exposed through one agent |
| 8 | **P0 — IT/security** | Precise two-signature authorization and key separation | Every individual signer and allowed pair tested on Testnet; master/regular/recovery states recorded | One compromised key pays by itself |
| 9 | **P0 — AP lead** | Explainable exception desk instead of silent AI refusal | Hold reason, cited evidence, severity, assigned owner and disposition | Missing receipt simply disappears from queue |
| 10 | **P0 — controller** | No incorrect “paid” messages | Stages distinguish requested, proposed, signed, submitted, validated, rail-pending and beneficiary-credited | API returns success before ledger validation |
| 11 | **P0 — CFO / auditor** | Exportable, tamper-evident evidence trail | File hashes, record versions, policy/model version, signer decision, operator identity, tx hash and timeline | Impossible to reconstruct who authorized a payment |
| 12 | **P0 — IT/treasury** | Pause all new authorizations and safe restart | Authenticated global/vendor kill switch; interruption and crash tests | Outage triggers duplicate submission |
| 13 | **P1 — finance risk** | Anomaly detection beyond simple policy limits | Explainable signals, true-positive/false-positive evaluation and reviewer routing | First beneficiary gets atypically large transfer |
| 14 | **P1 — compliance** | Sanctions/AML, jurisdiction and licensed-provider decision points | Route-dependent compliance policy and human/legal sign-off; no unsupported “compliant” label | Prohibited or unsupported corridor |
| 15 | **P1 — treasury** | FX quote transparency, fees and payout SLA | Quote/expiry, payer costs, delivery currency, beneficiary confirmation | Stablecoin settles but ZAR bank payout fails |
| 16 | **P1 — accountant** | ERP integration and matching | Reconciled vendor IDs, PO/GL/tax codes, credit notes, partial deliveries and ledger references | Books show two payments for one liability |
| 17 | **P1 — auditor** | Role-based access and privacy | Operator vs reviewer vs auditor vs Warden permissions; least-privilege model context | Bank details exposed in logs or public memos |
| 18 | **P1 — operations** | Human incident ownership and recovery | Key-rotation, stolen-operator, payout-dispute, failed-payout and outage runbooks rehearsed | Warden key compromised with no revocation plan |
| 19 | **P1 — CFO** | Cash and liabilities dashboard | Working wallet, reserves, queued/held invoices, maturity buckets and worst-case outstanding exposure | CFO cannot tell what has been committed vs paid |
| 20 | **P1 — AP manager** | SLA and exception aging | Time-to-resolution, overdue queue, approver bottlenecks and alerts | Important supplier held for days without notice |
| 21 | **P2 — procurement** | Contract, discount and credit-note intelligence | Original contract/credit terms and calculation provenance | Agent pays gross amount when approved credit applies |
| 22 | **P2 — CFO** | Measured economics | Baseline vs agent: touches/invoice, processing cost, straight-through rate, false holds, incidents | Unsubstantiated “fraud losses prevented” marketing |
| 23 | **P2 — internal auditor** | Period close and independent audit sampling | Sample/export across vendor changes, exceptions and policy revisions | Month-end liabilities cannot be reconciled |
| 24 | **P2 — engineering** | Model and policy change governance | Versioned deployments, regression corpus, rollback and approval history | A prompt update silently changes release behavior |

**Who owns what in the real team:** procurement owns supplier contract and PO; receiving owns independently recorded goods receipt; vendor-master/admin owns onboarding; AP prepares and investigates invoices; controller owns policies, segregation and exceptions; treasury owns liquidity and FX; CFO approves policy appetite and reviews exposure; security owns access, keys and incidents; audit has read-only independent evidence access. SignOff must not collapse all these roles into one “AI finance agent.”

**Prioritize proofs, not screens:** For the hackathon, demonstrate requirements #2–6, #8–12 with fictional but internally consistent records. Show #1 as a clearly simulated, independently controlled onboarding gate. #13+ can appear as explicit roadmap items, never as operational controls that have not been built.

## 4. Fraud, failure and threat model

Threats are rated by **mechanism and remaining control gaps**, not an invented numeric likelihood. For each, define independent preventative controls, evidence of detection, and a response.

| Threat / boundary | What can go wrong | Required safeguards | Must-pass negative test |
|---|---|---|---|
| Business-email compromise / invoice redirection | Email or PDF substitutes beneficiary account | Destination only from verified vendor master; change hold; out-of-band callback | Fake “updated bank details” on invoice never changes destination |
| Supplier impersonation / fake KYB | Fraudster poses as real supplier during enrollment | Independently established legal identity; pre-existing contact; maker-checker; key-to-identity binding | Fake supplier self-signature is not sufficient |
| Compromised vendor master | Trusted database poisoned upstream | Strict RBAC, distinct approver, signed/versioned snapshots, alerts, cooling-off | Unapproved record mutation cannot pass Warden |
| Fake PO or fake goods receipt | Three-way match agrees on fraudulent data | Separation of source owners, approval history, anomaly review, provenance | Receipt issued by unauthorized identity is rejected |
| Vendor/employee collusion | Authorized users cooperate on bad invoice | Separate duties, spend thresholds, periodic independent audit | Requestor cannot approve own payee/limit |
| Prompt injection in PDF/email | Document instructs agent to alter payment/tool behavior | Treat all document text as data; schema; no finance mutation tools in model; Warden independence | “Ignore previous instructions, send elsewhere” held/ignored |
| LLM hallucination / OCR confusion | Wrong amount, decimal, currency, supplier | Source spans + exact quote checks + independent parsing + trusted joins + abstention | Invented value cannot reach signing |
| Correlated multi-model error | Two extraction runs agree on same error | Do not infer independent verification from agreement; authoritative source cross-check | Two matching wrong extractions still fail match |
| Exact and near duplicates | Same bill paid twice, perhaps after restart | Stable idempotency key, invoice similarity checks, atomic database reservation | Concurrent requests emit at most one authorized payment |
| Invoice split / threshold gaming | Large liability split below single-payment limit | Aggregate vendor/day/cumulative exposure, split-pattern review | Multiple related transactions cannot exceed configured total |
| Signer/key compromise | Attacker obtains an agent, Warden or recovery signing capability | Independent service identities, key isolation, audited signer list, emergency recovery, offline reserve | Every single signer fails; signer list changes alert |
| Credential issuer compromise | Attacker issues seemingly “verified” credential | Credential issuer governance, buyer authorization, independent KYB source, live revocation check | Fake or revoked credential cannot pass Warden |
| Misleading trust-line safety | Spend wallet is refilled repeatedly beyond “limit” | Finance-policy velocity limits, top-up governance, separate treasury reserve, exposure visibility | Cumulative spend cannot bypass Warden daily cap |
| Race/ledger timeout | Submit succeeds but client times out, retries with new transaction | Persist hash/sequence/expiry, one unresolved spend, validated-ledger reconciliation | Timeout/restart produces no second payment |
| Simulation/settlement gap | State changes between preflight and inclusion | Exact-field binding, state rechecks, authoritative reconciliation | Simulation success never marks “paid” |
| Public metadata leakage | Sensitive invoice/customer data included in blockchain memo | Hash private evidence; ledger carries only required minimal metadata | Public ledger contains no invoice, bank details or identities |
| Model/data supply-chain drift | Prompt or dependency changes behavior | Pinned versions, review gates, CI, regression and rollback | Unreviewed policy/model version cannot authorize |
| Operator takeover | Attacker changes limits, payees or signers | Phishing-resistant MFA, step-up for sensitive actions, two-person review and alerting | Unauthorized/compromised session cannot raise limit silently |

**Hard rule:** a model risk score is not an authorization grant. A failed payee, duplicate, PO/receipt, identity, policy, jurisdiction or key check yields **HOLD** independent of how convincing the text or “confidence” appears.

## 5. Bounded agentic architecture: model proposes, Warden authorizes

### Trust zones

**Zone U — untrusted:** incoming PDF/email text, attachments, links, any external RAG retrieval, model output. Treat “system messages” embedded in an invoice as data and never execute instructions inside them.

**Zone E — restricted evidence:** supplier master, approved order, receipt, operator policy and verified change log. Only authorized business owners can modify; every record has identity, version, timestamps and approval chain.

**Zone A — proposer:** orchestrator with at most three model calls per invoice, narrowly typed read interfaces, no authority to update vendor, policy, signer list or treasury reserve. Agent key is not Warden key.

**Zone W — independent Warden:** separately deployed service and identity with authoritative reads, monotonic policy version, limit reservations, validated destination lookup and exact-transaction authorization. Refuses requests when evidence/state is unavailable.

**Zone X — XRPL:** on-ledger multisign authorization and final validated transaction state. No promise that ledger validates business invoice semantics. Credential/delegation assurances only after target-network test.

**Zone R — independent reconciliation + human review:** submission hash and status history; operator holds, audit, policy pause and recovery.

### Directed workflow

\`\`\`mermaid
flowchart TD
 A[Invoice arrival: untrusted] --> B[File validation, hash, quarantine]
 B --> C[Structured extraction + source spans]
 C --> D[Deterministic parsing + schema validation]
 D --> E[Join independently approved PO, receipt, supplier and policy]
 E --> F{Required evidence complete and hard rules pass?}
 F -- No --> H[HOLD: human-readable reason and owner]
 F -- Yes --> G[Anomaly signals and uncertainty checks]
 G -- Elevated or unknown --> H
 G -- Acceptable --> W[Independent Warden + reserve/idempotency lock]
 W --> S[Prepare exact XRPL transaction + optional simulate]
 S -- Unexpected / unavailable --> H
 S -- Eligible --> M[Agent and Warden sign identical finalized fields]
 M --> P[Persist hash, sequence, expiry; submit]
 P --> R[Validated-ledger reconciliation]
 R -- Final validated expected amount --> Z[SETTLED_ON_XRPL + audit receipt]
 R -- Unknown or divergent --> Q[RECONCILIATION_EXCEPTION]
 H --> O[Authenticated finance operator desk]
 Q --> O
\`\`\`

**Graph states:** \`RECEIVED\`, \`QUARANTINED\`, \`EXTRACTED\`, \`EVIDENCE_VERIFIED\`, \`HELD\`, \`WARDEN_ELIGIBLE\`, \`SIGNED\`, \`SUBMITTED\`, \`VALIDATED\`, \`RECONCILED\`, \`FAILED\`, \`RECONCILIATION_EXCEPTION\`. Make \`HELD\` a durable state; a user review does not mutate earlier evidence. Log each transition with policy version, actor/service identity, relevant record hashes, timestamp, reason code, and correlation ID. \`SETTLED_ON_XRPL\` is not \`SUPPLIER_BANK_CREDITED\`: the off-ramp is still simulated.

### Prompt, context, swarm and graph design

1. **Prompt engineering:** version extraction/review prompts; structured Zod schemas; require exact quotation and source page/range; instruct abstention for ambiguity; never let an invoice redefine tool access or destination.
2. **Context engineering:** each model sees only the minimum necessary bounded evidence, with source type, approver, creation time, confidence *origin*, and trust tier. The agent never sees signing seeds, unmasked bank data unless essential, or the full privileged Warden policy backend.
3. **Swarm engineering:** compare a single extraction call against an extractor + targeted procurement reviewer + targeted fraud reviewer (maximum three calls). Two LLMs agreeing is **correlated evidence**, not independent approval. If reviewers conflict, hold and explain.
4. **Graph engineering:** use LangGraph.js state transitions with durable checkpoints and typed interfaces. The graph coordinates work but cannot directly authorize settlement; Warden is an independent boundary, not another prompt persona. An evidence graph links the invoice hash to PO, receipt, supplier record, policy version and tx hash.

Suggested interfaces (illustrative, not implemented):

\`\`\`ts
type ExtractedField<T> = {
  value: T | null;
  rawQuote: string | null;
  sourceFileHash: string;
  page?: number;
  span?: [number, number];
  status: "EXACT" | "AMBIGUOUS" | "MISSING" | "CONFLICTING";
};
type PaymentProposal = {
  proposalId: string;
  invoiceId: string;
  invoiceHash: string;
  supplierId: string;
  poVersion: string;
  receiptVersion: string;
  requestedAmount: string; // decimal string, never floating-point money
  requestedCurrency: string;
  requestedDestination?: never; // Warden resolves from approved vendor master
};
type WardenDecision = {
  decisionId: string;
  proposalId: string;
  policyVersion: string;
  supplierRecordVersion: string;
  result: "ALLOW" | "HOLD";
  reasons: string[];
  txHash?: string;
};
\`\`\`

**Financial correctness notes:** use fixed-decimal/issued-token representation; verify issuer, currency, amount, destination, tags and transaction flags; never trust a model-supplied destination. Prevent TOCTOU by evaluating exact final fields and re-checking versions. Persist an atomic spend reservation and invoice idempotency identity before signing; never resubmit with a new payment identity until reconciler has proven the previous attempt cannot settle. Explicitly restrict Warden authorization to approved transaction types and monitored signer-account state.

## 6. Confidence: separate extraction quality, evidence and transaction safety

A single “98% safe” score is dangerous because it confuses different uncertainties. Use a **decision vector**, never a numeric permission bypass:

| Output | Meaning | Calibration / evidence | Effect |
|---|---|---|---|
| \`field_status\` | Whether an invoice field is quoted, parsed and source-located | Exact span test, deterministic parser, labeled examples | Missing/ambiguous required field → hold |
| \`extraction_quality_estimate\` | Likelihood a field was extracted correctly | Empirical labeled field accuracy by document type; calibrated score if sufficient data | Routing and reviewer attention only |
| \`business_evidence_status\` | Whether PO, receipt, vendor, change history and policy are authorized and consistent | Deterministic match with record versions and approval provenance | Any hard failure → hold |
| \`fraud_anomaly_score\` | Statistical unusualness of payment pattern | Historical legitimate/fraud or proxy labeled cases; error and false-positive estimates | Elevated risk → review, not auto-approval |
| \`settlement_status\` | Whether ledger actually settled the expected token/delivered amount | Validated on-ledger transaction and metadata | Determines real XRPL settlement state |

**Never treat a self-reported model 0.92 as a calibrated 92% probability.** For any probability estimator, evaluate reliability diagrams, expected calibration error (ECE), Brier score and score stability by supplier/document class. For selective automation measure the *risk–coverage curve*: as the system automatically handles more invoices, how many wrongly authorized cases occur and how many legitimate cases are needlessly held? Report field-level precision/recall, exact match, unsupported-field rate, abstention rate, false approvals, false holds, latency, token cost, reviewer effort and validated-payment success.

**Evaluation design:**
- Freeze a versioned representative dataset containing clean and messy text PDFs, different layouts, line items/currencies, missing fields, credits and amendments; identify supplier and document clusters to prevent train/test leakage.
- Separate **benign normal**, **benign edge cases**, **hostile input** and **upstream authority compromise**. Include counterfactual paired cases that differ only in payee, receipt, limit or hidden instruction.
- Test policy/ledger controls independently of LLM outputs using intentionally wrong field values.
- Report \`n\`, uncertainty intervals and all failures. If 0 bad authorizations occur in 100 independent malicious tests, that does **not** mean zero real-world risk. A rough “rule of three” upper 95% bound is ~3% under independent identical Bernoulli assumptions, which adversarial test suites rarely satisfy.
- Benchmark single-model baseline vs two-reader approach vs extractor + targeted reviewers under the same invoices, budget and conditions. Do not claim improvement without measured results.

**Illustrative decision policy:** \`ALLOW_CANDIDATE\` only when all required source fields are exact and verified, all mandatory authoritative records pass, no vendor/change/duplicate/payment-limit exception is present, source systems are available, signed policy is current, and empirically set anomaly criteria are satisfied. Then **Warden performs its own checks**; no agent can set the final \`ALLOW\` flag.

## 7. XRPL transaction and recovery validation checklist

The first spike must record source code version, network, ledger index, explorer transaction hashes, checked results and failed controls. No Testnet result is yet available in this repository.

- [ ] Provision test accounts and RLUSD trust lines; verify issuer/address and reserve requirements from target network (do not assume workshop approximations are current).
- [ ] Configure SPEND signer list with explicit addresses, weights and quorum; confirm intended master, regular and recovery states.
- [ ] Prove Agent-only failure, Warden-only failure, full intended multisign success; audit any single recovery path that can override quorum.
- [ ] Construct exact RLUSD payment; verify issuer, token amount, destination, destination tag if required, fees and \`LastLedgerSequence\`.
- [ ] Warden signs *only* after fresh vendor, policy, account state and idempotency checks; optional simulation is advisory.
- [ ] Persist transaction hash/sequence/expiry before submit, reconcile validated result/metadata including delivered amount, and handle timeout without duplicate.
- [ ] Test approval limit lowered after agent proposed but before Warden signs.
- [ ] Test pause, account exhaustion, missing trust line, wrong issuer, key rotation and signer-list change detection.
- [ ] If evaluating XRPL Credentials, independently verify issuer, subject, credential type, acceptance, expiry, deletion and current state on the target network. A credential alone does not enforce a payment allowlist.
- [ ] Verify \`PermissionDelegationV1_1\` activation on the **specific target network**; demonstrate permitted and rejected transaction types before promoting it. Keep out of MVP until baseline works.
- [ ] Label any bank transfer/FX payout/AVS/ERP as **SIMULATED** until there is a real integrated licensed partner and evidence of beneficiary credit.

Source guidance: [multisigning](https://xrpl.org/docs/concepts/accounts/multi-signing), [multi-signed transaction](https://xrpl.org/docs/tutorials/best-practices/key-management/send-a-multi-signed-transaction), [reliable submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission), [Credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials), [CredentialAccept](https://xrpl.org/docs/references/protocol/transactions/types/credentialaccept), [known amendments](https://xrpl.org/resources/known-amendments).

## 8. Minimum adversarial and recovery test matrix

| ID | Scenario | Expected |
|---|---|---|
| T01 | Clean authorized invoice, approved vendor, PO and receipt | Autonomous validated Testnet settlement and receipt |
| T02 | Agent signature alone | Ledger rejects or cannot validate |
| T03 | Warden signature alone | Ledger rejects or cannot validate |
| T04 | Any offline recovery signer alone | Either fails or explicitly documented emergency bypass with separate governance |
| T05 | Invoice contains changed payee instructions | Hold; verified vendor destination unchanged |
| T06 | Hidden prompt injection overrides role | Agent cannot change payee/policy/keys; hold if required extraction invalid |
| T07 | Amount/currency hallucination | Reject via raw-quote parse and independent match |
| T08 | Missing PO or goods receipt | Hold with exact reason |
| T09 | Exact duplicate and altered-document duplicate | Hold/review; no second spend |
| T10 | Concurrent API retries | One reserved payment identity, no duplicate |
| T11 | Limit exceeded or lowered before signing | Hold under current effective policy |
| T12 | Split invoices evade per-payment cap | Aggregate limit catches total exposure |
| T13 | Unapproved vendor-master mutation | Hold; approval audit evidence |
| T14 | Fake KYB / false supplier credential / revoked credential | Hold; credential never replaces offline verified identity |
| T15 | Single stolen operator identity tries to add payee/raise limit | Phishing-resistant step-up and independent approval prevent silent activation |
| T16 | Warden unavailable / wrong policy version | Fail closed, no new signature |
| T17 | Simulation success but state changes before inclusion | Final reconciler reflects validated truth, not simulation |
| T18 | Network timeout after submission | Persisted identity and validated ledger lookup avoid duplicate |
| T19 | Crash between signing, submission and acknowledgement | Recovery resumes original transaction identity |
| T20 | Signer-list mutation or key-compromise signal | Alarm, freeze Warden co-signing, controlled recovery |
| T21 | Legitimate unusual invoice | Appropriate hold/review, measure false-hold rate |
| T22 | Any upstream PO/receipt record with invalid authority | Hold despite model confidence or apparent 3-way match |

Evidence format for each test: fixture hash; exact expected state; actual state; rule/reason code; source and policy versions; trace; source commit; Testnet hash if applicable; pass/fail and reviewer. Do not publish keys, passwords, bank data or personal data in fixtures/logs.

## 9. Operator console designed for a finance team

**CFO overview:** spendable balance versus protected reserves, payable obligations, amount queued, number/age of holds, exposure by supplier and currency, authorized/settled/off-ramp-pending values, policy status and global pause. This is more decision-relevant than a decorative “AI confidence” number.

**AP payment desk:** supplier, invoice, amount, due date, PO/receipt badges, evidence and exceptions, approval state, payee-change alert, and a verifiable source link for each field. Distinguish \`Proposed\` from \`Signed\` from \`Validated on XRPL\` from \`Credited to bank (simulated/not integrated)\`.

**Fraud hold view:** show what changed, *old trusted destination vs requested untrusted destination* (safely masked), evidence chain, detection code, responsible finance owner, next authenticated action, cooling-off clock and review history. Do not provide a one-click “ignore controls” override.

**Policy desk:** approved roles and limits, two-person changes, staged effective times, test outcome for lower limit, immediate pause and read-only audit of prior versions. Ensure accessibility, mobile summaries and legible status wording.

**Auditor view:** searchable chain \`invoice hash → source quote → PO/receipt version → supplier verification → Warden rule result → final exact tx hash → validated metadata → bank leg simulation status\`; CSV/JSON export with redacted sensitive material.

## 10. Delivery plan: 13 November hackathon versus production

| Delivery gate | Build / measure | Stop condition |
|---|---|---|
| **Gate A — ledger proof** | RLUSD trust lines, 2-of-2 intended signer list, successful validated payment plus single-key rejections, explorer hashes | No successful safe Testnet path → no claim of live payment |
| **Gate B — Warden controls** | Authenticated proposal, verified destination, three-way match, duplicate lock, spending caps, hold reasons, policy pause | Any failed hard control permits co-signing → block demo release |
| **Gate C — reliability and evidence** | Real PDF extraction with source spans, negative fixtures, model baseline, evidence/event log | No measured results → label model benefits unverified |
| **Gate D — operations and UX** | Finance desk, changed-payee and lowered-limit hold, validated receipt, resilience on timeout | UI says “paid” before validated ledger → block release |
| **Gate E — credible pitch** | Consent-based finance lead interview; explicit real/simulated/unverified table; licensed-rail dependency and no savings claim | No customer interview → call commercial fit a hypothesis |
| **Later pilot** | Actual bank/KYB/ERP integrations, corridor legal review, independent security assessment, recovery and controls testing | No real-money operation before those gates |
| **Later differentiation** | Credentials, ledger delegation when target-network demonstrated, calibrated anomaly scoring, escrow, batching, wallet vendors | Never substitute feature demo for payment-control evidence |

**Competition positioning:** The strongest pitch is not “AI pays invoices with blockchain.” It is **“The agent can prepare and propose a payment, but the verifier it cannot control must co-sign, and every outcome is independently auditable.”** Show one successful Testnet payment, one changed-payee fraud hold, one policy hold, and an audit explanation; then discuss the South African supplier as a distribution *hypothesis*, not a validated buyer.

## 11. Regulatory, commercial and privacy boundaries

South Africa's 2026 proposed cross-border crypto framework is **draft**, not a settled authorization for this B2B scenario. National Treasury's 21 October 2026 statement indicated revision of the proposal. FIC/FSCA obligations depend on the actual product activities, custody and regulated parties; a lawyer must assess the specific South Africa–Zambia corridor, bank/FX integration, AML/CFT, tax and exchange control before any real-money pilot. The demo cannot establish regulatory compliance. Respect POPIA's data minimization and security-safeguard duties wherever personal information is processed.

The finance/bank leg is currently **simulated**. A Testnet RLUSD transfer is not a settled ZAR payout. A proposed supplier acquisition model is not validated customer willingness to pay. Currency conversion, partner SLAs, permitted beneficiaries, available off-ramp and any claimed financial savings remain unverified.

Sources: [SARB draft-crypto statement](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets), [National Treasury 2026 MTBPS](https://www.gov.za/news/speeches/minister-enoch-godongwana-medium-term-budget-policy-statement-2026-21-oct-2026), [FIC CASP guidance](https://www.fic.gov.za/accountable-institut/crypto-asset-service-providers/), [FSCA financial services](https://www.fsca.co.za/New-Financial-Service-Provider/), [Information Regulator security safeguards](https://inforegulator.org.za/knowledge-base/category/popia/chapter-3-conditions-for-lawful-processing/part-a-processing-of-personal-information-in-general/condition-7-security-safeguards/).

## 12. Recommended follow-up edits to existing docs

1. **\`docs/decisions/0004-workshop-adjustments.md\`:** mark status **proposed/testable**; replace “trust-line hard loss cap” with qualified holding/exposure constraint; change “not live” delegation to network-status verification; credentials as attestations only; simulation as preflight; reference signer recovery.
2. **\`docs/WORKSHOP.md\`:** preserve who said what as an **as-of-5-November** source note, then add dated correction for later-known amendment information and what remains unverified on Testnet.
3. **\`README.md\`:** replace definitive “not live on Testnet,” and “trust-line cap” with accurate qualified phrasing. Link this document as implementation requirements, but do not imply tests are finished.
4. **\`docs/TRUST.md\`:** extend the table to vendor-master compromise, credential issuer, operator takeover, emergency signer path, verified supplier change and ledger reconciliation, distinguishing ledger/Warden/human guarantees.
5. **\`docs/AGENT-RELIABILITY.md\`:** explicitly state raw-quote verification and two readers do not make malicious records trustworthy; introduce evidence-status vector, abstention and measured false-approval/false-hold evaluation. Make “zero wrong payments” a **test target** rather than a risk guarantee.
6. **\`docs/ENGINEERING.md\`:** add a concrete per-test evidence contract, a state-machine contract, one durable idempotency identity, transaction-finalization binding, failure-closed policy, single-signer including recovery matrix, and privacy/redaction checks.
7. **\`docs/HACKATHON.md\`:** clarify scored pitch claims are a narrative unless backed by commits, valid Testnet transaction hashes and a consenting interview.

**Scope rule:** This research document adds no running software, no keys and no production security certification. The changes above remain action items until the appropriate owner modifies, tests, reviews and merges the existing files.

## 13. Source and method index

This review synthesizes [SignOff's build brief](../BUILD-BRIEF.md), [PR #2](https://github.com/LethaboMH14/SignOff/pull/2) and its proposed research alongside the following external primary sources:

- **Ledger and settlement:** [XRPL multisigning](https://xrpl.org/docs/concepts/accounts/multi-signing); [SignerList](https://xrpl.org/docs/references/protocol/ledger-data/ledger-entry-types/signerlist); [Trust Line Tokens](https://xrpl.org/docs/concepts/tokens/fungible-tokens/trust-line-tokens); [Credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials); [Permission Delegation](https://xrpl.org/docs/concepts/accounts/permission-delegation); [Known Amendments](https://xrpl.org/resources/known-amendments); [Reliable Submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission).
- **AI governance and evaluation:** [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework), [NIST generative AI profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence), [NIST human-AI oversight](https://airc.nist.gov/airmf-resources/airmf/appendices/app-c-ai-risk-management-and-human-ai-interaction/); [risk-controlled abstention research](https://arxiv.org/abs/2607.04430) (**research idea**, not demonstrated specifically on SignOff).
- **Authentication and service trust:** [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html), [RFC 9421 HTTP message signatures](https://www.rfc-editor.org/rfc/rfc9421.html), [RFC 8032 EdDSA](https://www.rfc-editor.org/rfc/rfc8032.html). These are possible implementation patterns, not proof of implemented controls.
- **South African legal and privacy background:** [SARB draft](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/crypto-assets), [Treasury 21 Oct 2026](https://www.gov.za/news/speeches/minister-enoch-godongwana-medium-term-budget-policy-statement-2026-21-oct-2026), [FIC](https://www.fic.gov.za/accountable-institut/crypto-asset-service-providers/), [FSCA](https://www.fsca.co.za/New-Financial-Service-Provider/), [POPIA safeguards](https://inforegulator.org.za/knowledge-base/category/popia/chapter-3-conditions-for-lawful-processing/part-a-processing-of-personal-information-in-general/condition-7-security-safeguards/).

**Evaluation limitation:** This is a design review and research-based requirements analysis. No production CFO has validated the requirements; no live transactions or attack tests were executed; no current XRPL Testnet status query was run. The rigorous next step is *instrumented evidence*, not additional narrative claims.
