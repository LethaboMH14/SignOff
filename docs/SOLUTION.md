# The solution

This document explains what SignOff does, why it needs two signatures, and which simpler designs were considered. The build details are in [BUILD-BRIEF.md](../BUILD-BRIEF.md).

## In plain language

A company chequebook needs two signatures. The AI assistant holds one pen and does the paperwork. The second pen belongs to a rulebook the AI cannot read, edit or talk to. If a payment breaks a rule, the second signature never comes and the bank refuses the cheque. The "bank" is a public ledger, so anyone can check that the two-signature rule is switched on.

## Three parts, three jobs

Each part solves a different problem. Keeping them apart makes the pitch honest.

| Problem | What solves it |
|---|---|
| A fake "our bank details changed" email | Warden compares every payment with the supplier's verified payout record. Changes need the supplier's key, a cooling-off period and out-of-band confirmation. |
| The AI being tricked, or its key being stolen | A second signature the AI does not hold, required by the ledger |
| "Prove the agent cannot pay alone" | The ledger's signer list is public, so anyone can check that two signatures are required |

Two signatures are not what stops invoice fraud. They are what makes it safe to remove the human click, which is the hackathon track's requirement.

Be precise about the split: **the ledger guarantees only that no single key can pay.** Payee, invoice, duplicate, limit and transaction-type checks are enforced by Warden, a separately deployed service, not by the ledger. The full breakdown is in [TRUST.md](TRUST.md).

## The components

- **Agent.** Reads the invoice, extracts fields with their source text, matches them to a purchase order and goods-received record, and proposes a payment. It treats invoice content as untrusted. It holds one signing key and can submit nothing alone.
- **Warden.** A separate service with its own deployment and its own key. It runs fixed rules, with no AI model in the decision. It is the only component that submits to the ledger.
- **Supplier payout record.** The supplier's payment destination, signed by the supplier after its identity and bank account are verified outside the system. Warden compares every payment against it. Enrolment, changes and recovery are in [TRUST.md](TRUST.md).
- **Operator console.** Where a finance person sets limits, approves suppliers, pauses the system and reads why something was held.
- **Ledger.** An XRPL account that requires two signatures. Settlement is in RLUSD on Testnet.

The agent reaches Warden through an MCP tool (`propose_payment`, plus read-only queries). The track description says agents should be "powered by MCPs", so this interface is part of the design, not an extra.

## The rules

Warden checks every rule. One failure means hold.

**Who is paid**
- The destination matches the supplier's signed payout record.
- A new or changed destination waits out a cooling-off period and needs the operator.
- The supplier is on the operator's approved list.

**What is paid**
- The invoice matches a purchase order and a goods-received record.
- The same supplier and invoice number has not been paid and is not in flight.
- Required fields are present and each has a source span. If the agent is unsure, it abstains.

**How much**
- The amount equals the invoice exactly.
- The amount is within the per-payment and per-supplier limits.
- The rolling daily total stays within the daily limit, counted from the ledger's own history.

**How**
- The transaction is a plain payment in RLUSD from the expected issuer.
- No partial-payment flag, no alternative paths.
- No transaction that changes signers, keys or limits.

**System state**
- The operator has not paused the system.
- Only one payment is in flight per account.
- If Warden cannot read the ledger, it refuses.
- Repeated refusals trip a circuit breaker until the operator re-enables the agent.

## Simpler options considered

| Option | Stops a tricked AI | Survives one stolen key | Signature requirement publicly checkable | Effort |
|---|---|---|---|---|
| A human approves every payment | Yes | Yes | No | Lowest, but not autonomous |
| The AI holds the only key, with a small balance cap | No, the loss is only capped | No | Partly | Low |
| Warden holds the only key and the AI just proposes | Yes | No | No | Low |
| **Two signatures on the account (ordinary multi-signing)** | **Yes** | **Yes** | **Yes** | One extra setup transaction |
| Two signatures plus permission delegation | Yes | Yes | Yes, and limits transaction types | Highest |

The team accepted the fourth option as the core in [ADR 0002](decisions/0002-plain-multisign-core.md), with delegation as an optional enhancement. Ordinary multi-signing is long established on the ledger. Permission delegation was reported as still disabled in August 2026 and eligible to activate only from 8 October ([Cryptoticker](https://cryptoticker.io/en/xrpl-permission-delegation-activation/)); its status on Testnet has not been checked by us. In the "Stops a tricked AI" column, the stopping is done by Warden's rules; the ledger's part is ensuring the AI cannot pay without Warden.

## What the design does not protect against

- A stolen operator credential or recovery key.
- An approved supplier that is itself dishonest or compromised. See the limits of supplier-signed records in [TRUST.md](TRUST.md).
- A compromised Warden. It cannot pay alone, but it is the only component checking payees and limits.
- Both the agent and Warden keys stolen together. The loss is then bounded by the spending account's balance, which the operator keeps small and separate from reserves.
- The RLUSD issuer freezing or clawing back the asset.

## Quantum: considered and left out

Quantum finance and quantum key distribution add nothing to this product. The one relevant point is future-proofing of signatures. Ripple has published a plan targeting post-quantum readiness by 2028, with a quantum-safe signature scheme on a test network since December 2025; nothing is live on the main network ([crypto.news](https://crypto.news/ripple-plans-quantum-resistant-xrp-ledger-by-2028/), disputed by [Quantum Zeitgeist](https://quantumzeitgeist.com/?p=352460)). An XRPL account can change its signers without changing its address, and SignOff anchors hashes, which are far less exposed. See [ADR 0003](decisions/0003-no-quantum-in-mvp.md).
