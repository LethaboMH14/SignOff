# Warden P0 — Live Testnet negative proof runbook

**Status:** Scripted, **NOT RUN** as part of this PR. Applies to a controlled XRP Ledger **Testnet** account using the test-issued **TST** token, **not RLUSD**. Follow [issue #45](https://github.com/LethaboMH14/SignOff/issues/45) and [PR #54](https://github.com/LethaboMH14/SignOff/pull/54).

## Purpose

Demonstrate that a captured, unsigned Warden-prepared payment cannot be completed by the AI agent alone, and that **a late operator STOP blocks Warden's final authorization**.

The new `p0-stop` command:

1. Requires a fresh, unpaused Testnet Warden session, then enrolls the fictional supplier with independent operator approval.
2. Proposes a previously unused test payable, and confirms the response has **no Warden signature**.
3. Signs the prepared transaction with the **agent key only**, checks it has exactly one signer, and submits it on Testnet. A healthy result is **`tefBAD_QUORUM`**, not a payment.
4. Issues an authenticated operator STOP, then calls the Warden's finalization endpoint using the captured agent-only signature. The correct response is **409 — blocked**, with no Warden signature returned.
5. Resumes only the pause this test set and verifies the supplier's TST balance did not change.

The script prints individual pass/fail evidence as JSON. No wallet addresses, seeds, supplier PII or raw transaction blobs belong in the evidence log or submission video.

## Execute with operator-owned Testnet material

On the controlled development machine (not in GitHub Actions), first provision Gate A's Testnet accounts using the documented Gate A procedure and prepare a **fresh** Warden directory:

```bash
npm ci
npm run testnet:gate-b -- prepare
```

Start the Warden in a separate terminal using the repository's normal `warden:serve` entry point. In the original terminal:

```bash
npm run testnet:gate-b -- p0-stop
```

Only run this against the allow-listed XRP Ledger Testnet endpoints and the team's disposable, test-funded account. The `prepare` step refuses an existing Warden event log; do not delete or bypass any lock or audit history just to obtain a green test.

## Required acceptance record

Save the exact code commit and CI run; then record the Testnet ledger index/time, observed `tefBAD_QUORUM`, the Warden's HTTP 409, and unchanged supplier **TST** balance. Include evidence that the Warden did not emit a usable signature. A screenshot is supplementary; inspect the public ledger state independently before claiming the proof passed.

Do not mark issue #45 fully closed until this live negative proof and the independently reviewed exact-head regression tests are recorded. The STOP control **does not undo** a transaction already fully signed and submitted: it prevents new authorizations.

## Limits

This is a negative security regression, **not** a demonstration of a validated RLUSD payment, live model inference, a bank payout or production-grade custody. A production deployment would need durable cross-instance authorization locks, operational controls and further adversarial review.