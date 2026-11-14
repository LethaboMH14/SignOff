# Warden attack suite

The attack suite shows, case by case, how the Warden holds, refuses or rejects each attack in the Gate B acceptance list in [BUILD-BRIEF.md](../BUILD-BRIEF.md#acceptance). Each case is a named test with an expected observable outcome: a decision (HOLD or REFUSE) with its reason code, or a co-signature rejected with its HTTP status, or a ledger engine result.

## Run it

```bash
npm run attack
```

The command runs `apps/warden/test/attacks` under vitest (two workers) and prints one table: the case ID, what the case does, the expected outcome, and PASS or FAIL. It runs offline against the in-memory ledger in `packages/xrpl/test/helpers/fake-ledger.ts`. **It is not a Testnet run**, and it does not prove anything about live XRPL behaviour. Live Testnet evidence is logged separately in [docs/logs/TEST-LOG.md](logs/TEST-LOG.md).

The unit tests run the same cases as part of `npm test`.

## Cases

Titles follow `ID | case | expected outcome`. The `PIN-` rows pin the #45 repair.

| ID | Attack | Expected outcome | Test file |
|---|---|---|---|
| ATK-01 | Changed payee, printed on the invoice; payout change pending | HOLD `PAYEE_CHANGED`, nothing submitted | `payee-and-supplier.test.ts` |
| ATK-02 | Hidden instruction in invoice text (printed payee field); smuggled fields in the proposal body | HOLD `PAYEE_CHANGED`; REFUSE `INVARIANT_FAILED`, no attempt recorded | `payee-and-supplier.test.ts` |
| ATK-03 | Single compromised supplier key requests a payout change; cooling-off passes with no second approval | Payee unchanged; HOLD `PAYEE_CHANGED` | `payee-and-supplier.test.ts` |
| ATK-04 | Missing goods receipt | HOLD `MISSING_EVIDENCE` | `evidence-and-payables.test.ts` |
| ATK-05 | Duplicate invoice, already paid, new attempt id | HOLD `DUPLICATE` | `evidence-and-payables.test.ts` |
| ATK-06 | Five concurrent requests for one payable | Exactly one ALLOW, four HOLD `DUPLICATE` | `evidence-and-payables.test.ts` |
| ATK-07 | Excess amount above the invoice; invoice above the per-payment limit | HOLD `AMOUNT_MISMATCH`; HOLD `OVER_LIMIT` | `evidence-and-payables.test.ts` |
| ATK-08 | Single compromised key: agent alone, or Warden alone, broadcasts | Ledger rejects `tefBAD_QUORUM`; attempt stays awaiting | `control-and-ledger.test.ts` |
| ATK-09 | Ledger timeout before signing; ledger timeout at final authorization | HOLD `LEDGER_UNREADABLE`; REJECTED 503, nothing submitted | `control-and-ledger.test.ts` |
| ATK-10 | Limit lowered while a proposal is in flight; lowered limit for the next proposal | REJECTED 409 `policy changed`; HOLD `OVER_LIMIT` | `control-and-ledger.test.ts` |
| ATK-11 | Pause while a proposal is in flight; pause before a proposal | REJECTED 409 `paused`, pays after resume; HOLD `PAUSED` | `control-and-ledger.test.ts` |
| ATK-12 | Non-payment transaction type (`AccountSet`) co-signed by the agent | REJECTED 422, nothing submitted | `control-and-ledger.test.ts` |
| ATK-13 | Payee holds the currency only from another issuer; alternate asset from an unapproved issuer | HOLD `INVARIANT_FAILED`; REFUSE `UNSUPPORTED_TRANSACTION` | `control-and-ledger.test.ts` |
| PIN-01 | Proposal returns unsigned terms | ALLOW, with no Warden signature in `toCoSign` | `final-authorization.test.ts` |
| PIN-02 | Policy changed between proposal and final authorization | REJECTED 409, nothing submitted | `final-authorization.test.ts` |
| PIN-03 | Trust line frozen after proposal | REJECTED 409 at the Warden re-check, nothing submitted | `final-authorization.test.ts` |
| PIN-04 | Agent alters the amount before co-signing | REJECTED 422; the Warden does not sign altered terms | `final-authorization.test.ts` |
| PIN-05 | Payout change requested after proposal | REJECTED 409, propose again | `final-authorization.test.ts` |

The helpers live in `apps/warden/test/attacks/attack-world.ts`. The runner is `scripts/attack-suite.ts`.

## What this does not prove

- **In-memory ledger, not XRPL.** Multi-signing quorum, freezes and trust lines are modelled by the fake ledger. A live Testnet run is needed before any claim about the real network.
- **Simulated identity.** The payee check uses `simulatedIdentityChecker`, so "verified" means "on the allow-list", not an independently verified supplier.
- **Transaction-type restriction is a Warden check.** The ledger's signer list does not restrict which transaction types the two signers send together (see [BUILD-BRIEF.md](../BUILD-BRIEF.md#xrpl-spike)). ATK-12 shows the Warden refusing `AccountSet`; it is not a ledger guarantee.
- **Wrong issuer is tested at two points only.** ATK-13 covers a payee with no trust line to the expected issuer and an unapproved alternate asset. It does not cover every way a ledger asset could be spoofed.
- **Service layer only.** The cases call `WardenService` directly. They do not go through the HTTP server or the operator console, and they do not test the agent's extraction or prompt behaviour.
- **Concurrency is in-process.** ATK-06 runs five proposals in one process. It does not test several Warden instances sharing storage.
- **Counts are a snapshot.** The count in the table is what the suite contains now; the TEST-LOG row records the run that produced it.
