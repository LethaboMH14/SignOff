# Trust boundaries

Who is trusted with what, what the XRP Ledger guarantees, and what only Warden or a person enforces. **This is the planned design. None of it is built or tested yet.**

## The short version

- **The ledger guarantees one thing:** no single key can spend from the spending account. A payment needs both the agent's and Warden's signatures.
- **Warden enforces everything else:** who is paid, what is paid, how much, and what kind of transaction. These are software checks in a separately deployed service, not ledger rules.
- **People enforce identity:** a supplier's payout details are only trusted after its identity has been verified outside the system, and changes go through an authenticated, delayed process.

If Warden is wrong or compromised, the ledger still stops the agent alone, but it does not check payees, invoices or limits.

## What each layer guarantees

| Guarantee | Enforced by | Survives a tricked agent | Survives a stolen agent key | Survives a compromised Warden |
|---|---|---|---|---|
| No payment with one signature | XRP Ledger (signer list, quorum two) | Yes | Yes | Yes, alone |
| Payee matches the supplier's verified payout record | Warden | Yes | Yes | No |
| Invoice matches order and goods receipt | Warden | Yes | Yes | No |
| No duplicate payment | Warden | Yes | Yes | No |
| Per-payment, per-supplier and daily limits | Warden | Yes | Yes | No |
| Only a plain RLUSD payment, nothing that changes signers or settings | Warden (baseline); the ledger also, only if delegation is later enabled and verified | Yes | Yes | No, unless delegation is in place |
| Pause stops new payments | Warden refuses to co-sign | Yes | Yes | No |
| Maximum loss if both keys are stolen | Balance held in the spending account | n/a | n/a | n/a |

The last row is why the spending account holds only a working balance. Reserves stay in a separate account that neither key controls.

## Who holds which key

| Key | Held by | Can do | Cannot do |
|---|---|---|---|
| Agent signing key | Agent service | Sign a proposed payment | Pay alone; read Warden's key or records |
| Warden signing key | Warden service, separate deployment and identity | Co-sign and submit an eligible payment | Pay alone |
| Operator credentials | Finance operator | Change limits, approve suppliers, pause, start recovery | Pay without the two service signatures |
| Operator recovery key | Offline, operator's custody | Replace the signer list | Be used in normal operation |
| Supplier key | South African supplier | Sign its own payout record | Move any buyer's money |

## Supplier enrolment

A supplier's own signature proves only that the holder of a key signed the record. It does not prove who that holder is. Enrolment therefore needs an independent link to the real business.

1. **Invitation.** The buyer's operator invites a supplier it already trades with, or the supplier applies.
2. **Identity check outside the system.** Confirm the registered company, and confirm the bank account belongs to it through bank account verification (AVS) or an equivalent. **Simulated in the demo.**
3. **Out-of-band confirmation.** The operator confirms the enrolment with the supplier using contact details already on file, not details from the enrolment request.
4. **Key binding.** The supplier generates its key and signs its payout record. Warden stores the record, the public key and the evidence of steps 2 and 3.
5. **Operator approval.** The supplier becomes payable only after the operator approves it.

## Changing payout details or keys

Any change follows the same path:

1. The supplier signs the new record with its **current** key.
2. Warden starts a cooling-off period. Payments to the supplier are held during it.
3. The operator is notified and confirms the change out of band.
4. The new details are re-verified as in enrolment step 2.
5. Only then does Warden use the new record.

A change signed with an unknown key is refused. A change that arrives by email or on an invoice is ignored.

## Recovery

| Lost or stolen | Response |
|---|---|
| Agent key | Pause. Use the recovery key to replace the agent signer. The stolen key cannot pay alone. |
| Warden key | Pause. Replace the Warden signer the same way. The stolen key cannot pay alone. |
| Both service keys | The spending balance is at risk. Pause, replace both signers with the recovery key, and move any remaining balance. |
| Supplier key | The supplier re-enrols through the full identity check. Payments to it are held until then. |
| Operator credentials | Outside this design's protection. Mitigate with strong authentication and a second approver for limit increases. |
| Operator recovery key | Outside this design's protection. Keep it offline and separate from day-to-day credentials. |

Recovery steps will be tested on Testnet before they are claimed.

## Limits of supplier-signed records

- They do not stop a dishonest supplier from invoicing for goods it did not deliver. The goods-received check does that.
- They are only as good as the identity check at enrolment.
- If the supplier's own systems or key are compromised, a fraudster can sign a change. The cooling-off period and out-of-band confirmation are the defence.
- They do not tell a bank anything. A rand payout still depends on the partner's own checks.
- In the hackathon build they are held by Warden. Anchoring them on the ledger is a stretch goal.
