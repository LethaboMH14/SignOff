# 0004: Adjustments after the Ripple workshop

- **Status:** Proposed, 10 November 2026. Awaiting team sign-off.
- **Affects:** [BUILD-BRIEF.md](../../BUILD-BRIEF.md) "XRPL spike", [TRUST.md](../TRUST.md), [ENGINEERING.md](../ENGINEERING.md).
- **Source:** [WORKSHOP.md](../WORKSHOP.md).

## Context

The track is "an AI agent that moves money for a real business, with the XRP Ledger enforcing the rules". Today the ledger enforces only one rule in SignOff: no single key can pay. Everything else is Warden. A Ripple developer advocate who will judge said in the workshop that credentials and batch transactions are live, that permission delegation is not, and that every RLUSD holder needs a trust line and reserve.

## Decision

Move more of the rules onto the ledger, using only features that are live on Testnet.

| Rule | Before | Proposed |
|---|---|---|
| No payment with one key | Ledger (multi-signing) | Unchanged |
| Maximum the spending account can lose | Operator keeps the balance small | **Ledger:** the spending account's RLUSD trust line limit caps what it can ever hold. The operator tops it up from reserves. |
| Supplier's payout account is verified | Warden's private record | **Ledger:** after the off-ledger identity and bank check, the operator's verifier account issues an XRPL **credential** to the supplier's payout account. Warden only pays accounts holding an accepted, unexpired credential. Anyone can check it on the explorer. |
| Revoking a supplier | Warden record change | **Ledger:** delete the credential; Warden stops paying immediately. |
| Payment preview | Not specified | Warden **simulates** every payment before co-signing and holds it if the result is not success. |

Stretch goals, only after the core loop, console and attack suite work:

- **Batch:** pay several approved invoices to different suppliers all-or-nothing.
- **Token escrow:** lock a payment until the goods are received, if the RLUSD issuer allows it on Testnet.
- **Privy agent wallet:** keep the agent's signing key in Privy instead of our secret store, if Privy can produce a signature that works in an XRPL multi-signed transaction.

Dropped from the hackathon: **permission delegation**. It is not live, and using it would move the demo to Devnet.

## What stays honest

- A credential proves that our verifier vouched for an account. It does not prove the verification was correct, and the ledger does not stop the two signers paying an account without one. That refusal is still a Warden check. [TRUST.md](../TRUST.md) must say so.
- Credentials add reserve cost to the supplier's account (0.2 XRP each) and require the supplier to accept the credential.
- The credential and trust-line behaviour must be verified on Testnet in the first spike before any document claims it.

## Why

- It answers "the XRP Ledger enforcing the rules" with three ledger-level controls instead of one, using features the judge named.
- It makes supplier verification publicly auditable, which is the heart of the fraud story.
- It costs little: a few setup transactions and one ledger read per payment.
