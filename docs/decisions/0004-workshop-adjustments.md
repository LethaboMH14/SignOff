# 0004: Ledger features to test after the Ripple workshop

- **Status:** Proposed as a **test plan**, 10 November 2026. Accepted by the reviewer only as a plan, not as proven ledger guarantees. Nothing below may be claimed until the Testnet evidence listed under each item exists.
- **Affects:** [BUILD-BRIEF.md](../../BUILD-BRIEF.md) "XRPL spike", [TRUST.md](../TRUST.md), [ENGINEERING.md](../ENGINEERING.md).
- **Sources:** [WORKSHOP.md](../WORKSHOP.md); review on pull request 2; [CFO and fraud research](../CFO-AGENTIC-FRAUD-SECURITY-RESEARCH-2026-11-10.md), sections 2 and 7.

## Context

The track is "an AI agent that moves money for a real business, with the XRP Ledger enforcing the rules". In SignOff the ledger is intended to enforce one rule: a payment needs signatures from both the agent and Warden. Everything else is Warden or a person. The workshop named several live XRPL features. Review showed that some of the first version of this record overstated what those features guarantee.

None of these items may delay the core: a real two-signature RLUSD payment on Testnet, a changed-payee hold, and a lowered-limit hold.

## Items to test

### 1. Signer list and every signing path (core, not optional)

The claim "no single key can pay" is only true if no usable key reaches the quorum alone, including any master or regular key. Revised after review: an earlier proposal (Agent 1, Warden 2, recovery 1, quorum 3) let Warden plus the recovery key pay without the agent. The recovery signer is removed.

Configuration to test: Agent 1, Warden 1, quorum 2; master key disabled; no regular key; no recovery signer. Agent + Warden is the only signing path, for payments and for account changes. Warden refuses account changes unless two people have approved them through the authenticated operator route. Recovery is off-ledger: abandon the account and fund a new one from a separately held reserve. Details in [TRUST.md](../TRUST.md#signer-configuration-and-every-signing-path).

**Evidence required:** results for Agent alone, Warden alone, Agent + Warden; a signer-list change refused by Warden without approvals; a rebuild from the reserve.

### 2. Trust line limit (exposure control, not a loss cap)

An RLUSD trust line limit ordinarily restricts how much the account accepts from others. The account's own actions can take the balance above it, the limit can be changed by a signed transaction, and it does not cover XRP. **It is not a cap on what the account can hold, spend or lose.**

Use it only as one layer, alongside: a small pre-funded spending balance, a separate reserve the payment keys cannot reach, Warden's per-payment, per-supplier and daily limits, Warden refusing `TrustSet` and every non-payment transaction, and exposure computed from the actual spendable balance.

**Evidence required:** observed behaviour at, above and after changing the limit.

### 3. Credentials (attestation, stretch)

A credential is a public statement by its issuer about an account. It does not prove the supplier's identity, bank-account ownership or control of the key, and the ledger does not stop the signers paying an account without one.

If used, it is issued only after the off-ledger checks in [TRUST.md](../TRUST.md), and Warden checks issuer, subject, type, acceptance, expiry and revocation against the current ledger immediately before signing. Risks to document: wrong issuance, a stolen supplier key, a gap between revocation and the next check, and credential metadata being public.

**Evidence required:** issue, accept, check, expire and delete on Testnet. Until then, stretch only.

### 4. Simulation (preflight, not settlement)

`simulate` previews a transaction against the current ledger. The ledger can change before submission and simulation moves no money.

Warden binds its decision to the exact final transaction fields and policy version, signs only those bytes, stores the sequence, hash and expiry before submitting, then shows "paid" only after a **validated** transaction with the expected delivered amount.

**Evidence required:** tests for state changes between simulate and submit, timeouts, restarts, retries and duplicate submissions.

### 5. Permission delegation (out of the critical path)

The workshop on 5 November described it as not yet live. The reviewer reports that `PermissionDelegationV1_1` activated on mainnet in October 2026; the official amendments page we could read was a September snapshot showing it still in voting. **Its status on our target Testnet is unverified.** It stays out of the hackathon build for schedule reasons. If ever used, avoid delegating any burn-type payment permission until its documented caveats are checked.

**Evidence required:** a `feature` query on the Testnet node and a real test transaction.

### 6. Stretch, only after the delivery gates in ENGINEERING.md

Batch payment of several invoices, token escrow until goods are received (only if the RLUSD issuer allows it on Testnet), and a Privy agent wallet (only if it can sign for an XRPL multi-signed transaction).

## Why

These items move as much as is honestly possible onto the ledger, using features the Ripple judge named, while keeping every claim tied to evidence.
