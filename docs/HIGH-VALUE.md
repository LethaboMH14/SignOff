# High-value payments: the owner signs on their phone

Status: Testnet only. Verified 13 Nov 2026 (T-271, T-272, T-273). Every amount is fictional, the RLUSD has no value,
and the threshold is scaled down for the demo.

## What it does

A supplier payment at or above the threshold does not come from the spending account. It comes from a separate
**high-value (treasury) account** whose signer list is the agent, the Warden and the owner, with quorum 3. The ledger
refuses a payment that has only the agent and the Warden, so the owner's signature is enforced by the network, not
by our software.

Routine payments are unchanged: the spending account, agent and Warden, quorum 2, no human click.

## Why a second account

A ledger signer list cannot depend on the amount. One account cannot require the owner only above a value, so the
high-value payments come from an account that always needs the owner's signature.

## The flow

1. The agent reads the invoice and matches it to the order and the goods received.
2. The Warden runs its rules. Above the threshold it signs its own half and asks the owner to approve.
3. The owner gets a Xaman request on their phone: payee, amount and the Warden's verdict. They approve with Face ID or
   PIN. The request expires after 4 minutes; nothing is sent if the owner rejects it or it expires.
4. The Warden checks the owner's blob is the same transaction and signed by the owner alone, combines the three
   signatures and submits.
5. The owner is told at each step, in plain words, by a log the console reads and by Telegram when it is set up.

## Running it

- One-time setup: `npm run testnet:high-value` (creates the treasury, sets the three-signer list and the RLUSD trust
  line, moves a few Testnet RLUSD in from the spending account, and adds the route to the local Warden's config).
- Set `XAMAN_API_KEY`, `XAMAN_API_SECRET` and `XAMAN_APPROVER_ADDRESS` in `.env` (never printed, never committed).
- `npm run demo -- --zar 60.00` runs one invoice above the threshold end to end.

## What is simulated

- The threshold: 3.00 RLUSD on Testnet, standing in for R100,000.
- The kwacha in: shown at an illustrative rate; no money moves.
- The rand out: simulated locally. A Paystack test-mode transfer is supported with a `sk_test_` key; a live key is refused.

## Limits, stated plainly

- The owner's phone is on Xaman's Testnet; the approver's keys are not held by us.
- Push notifications need a push token from a first approval; without one the owner opens a link or QR.
- A Testnet run validated in ledger 22300977 (T-273). A later live run is not claimed here.
