# Trust boundaries

Who is trusted with what, what the XRP Ledger enforces, what only Warden enforces, and what depends on people. **This is the planned design. None of it is built or tested yet.** Every "enforced by the ledger" statement below is a design intent until the Testnet evidence in [ADR 0004](decisions/0004-workshop-adjustments.md) exists.

## The short version

- **The ledger is intended to enforce one thing:** a payment from the spending account needs signatures whose weights reach the quorum, and no single usable key reaches it alone. This holds only if the signer weights below are configured and tested as designed.
- **Warden enforces everything else:** who is paid, what is paid, how much, and what kind of transaction. These are software checks in a separately deployed service, not ledger rules.
- **People enforce identity and authority:** supplier verification, approval of changes, and the records Warden relies on (supplier list, purchase orders, delivery records).

A perfect agent can still propose a fraudulent payment if the records it is checked against are wrong. The model is not the only thing to distrust.

## Signer configuration and every signing path

Proposed configuration, to be tested on Testnet:

| Signer | Held by | Weight |
|---|---|---|
| Agent | Agent service | 1 |
| Warden | Warden service, separate deployment and identity | 2 |
| Operator recovery | Offline, operator's custody | 1 |
| **Quorum** | | **3** |

The spending account's master key is disabled and it has no regular key.

| Signing path | Weight | Intended result | Purpose |
|---|---|---|---|
| Agent alone | 1 | Rejected | |
| Warden alone | 2 | Rejected | |
| Recovery alone | 1 | Rejected | |
| Agent + Warden | 3 | Accepted | Normal payments |
| Warden + Recovery | 3 | Accepted | Replace a lost or stolen agent key |
| Agent + Recovery | 2 | Rejected | Warden cannot be bypassed |

There is **no single-key override**. The consequence: if the Warden key is lost, nothing in the spending account can be moved. That is accepted because the spending account holds only a small working balance; reserves sit in a separate account the payment keys cannot reach.

Every row needs a Testnet result code or hash before it is claimed.

## What each layer guarantees

| Guarantee | Enforced by | Holds if the agent is tricked | Holds if the agent key is stolen | Holds if Warden is compromised |
|---|---|---|---|---|
| No payment below quorum | XRP Ledger, if configured as above | Yes | Yes | Yes, alone |
| Payee matches a verified supplier record | Warden | Yes | Yes | No |
| Credential on the payee account is current (stretch) | Warden reads the ledger; the ledger only stores the credential | Yes | Yes | No |
| Invoice matches purchase order and delivery record | Warden | Yes | Yes | No |
| No duplicate payment | Warden | Yes | Yes | No |
| Per-payment, per-supplier and daily limits | Warden | Yes | Yes | No |
| Only a plain RLUSD payment; no `TrustSet`, signer-list or settings changes | Warden (delegation could add a ledger restriction later, if verified) | Yes | Yes | No |
| Pause stops new payments | Warden refuses to co-sign | Yes | Yes | No |
| "Paid" shown only after a validated ledger result | Reconciler | Yes | Yes | No |
| Maximum loss if Agent and Warden keys are both stolen | The spending account's actual balance | n/a | n/a | n/a |

The RLUSD trust line limit is **not** a loss cap: the account's own actions can exceed it, it can be changed, and it does not cover XRP. It is one exposure layer alongside the small balance, the separate reserve and Warden's limits.

## Who holds which key

| Key | Held by | Can do | Cannot do |
|---|---|---|---|
| Agent signing key | Agent service | Sign a proposed payment | Pay alone; read Warden's key or records |
| Warden signing key | Warden service | Co-sign and submit an eligible payment | Pay alone |
| Operator recovery key | Offline, operator | With Warden, replace the agent signer | Pay or change signers alone; pair with the agent |
| Operator login | Finance operator | Change limits, approve suppliers, pause | Sign transactions |
| Credential issuer key (stretch) | Operator's verifier account | Issue and delete supplier credentials | Move money |
| Supplier key | South African supplier | Sign its own payout record | Move any buyer's money |

## Threats from upstream of the agent

| Threat | What it does | Defence | Who enforces |
|---|---|---|---|
| Supplier list (vendor master) altered | Real-looking payee points to a fraudster | Changes need maker-checker approval, a cooling-off period and an alert; Warden fails closed on unapproved changes | Warden and people |
| Fake purchase order or delivery record | A consistent but fraudulent invoice passes matching | Separate roles for raising orders, receiving goods and approving payment; provenance on every record | People, recorded by Warden |
| Credential issued wrongly (stretch) | A fraudster's account looks verified | Issuance only after the full enrolment checks, by a separate role; credential treated as evidence, not authority | People |
| Operator login taken over | Limits raised, suppliers approved | Strong authentication; a second approver for limit increases and new suppliers; alerts | People |
| Insider collusion | Two roles cooperate | Out of scope for the hackathon; audit trail makes it detectable | People |
| Supplier's own systems compromised | A change is signed with the real supplier key | Cooling-off period and out-of-band confirmation | Warden and people |
| Ledger and Warden disagree after a failure | Payment shown wrongly as paid or unpaid | Reconciler checks validated ledger data and delivered amount before any status change; retries only after reconciling | Reconciler |

## Supplier enrolment

A supplier's own signature proves only that the holder of a key signed the record. It does not prove who that holder is. Enrolment needs an independent link to the real business.

1. **Invitation.** The buyer's operator invites a supplier it already trades with, or the supplier applies.
2. **Identity check outside the system.** Confirm the registered company, and confirm the bank account belongs to it through bank account verification (AVS) or an equivalent. **Simulated in the demo.**
3. **Out-of-band confirmation.** The operator confirms with the supplier using contact details already on file, not details from the request.
4. **Key binding.** The supplier generates its key and signs its payout record. Warden stores the record, the public key and the evidence of steps 2 and 3.
5. **Approval by a second person.** The person who enrolled the supplier cannot also approve it.
6. **Credential (stretch).** The verifier account issues a credential to the payout account, and the supplier accepts it.

## Changing payout details or keys

1. The supplier signs the new record with its **current** key.
2. Warden starts a cooling-off period. Payments to the supplier are held.
3. The operator confirms the change out of band, and a second person approves it.
4. The new details are re-verified as in enrolment step 2.
5. Only then does Warden use the new record. Any credential is reissued for the new account.

A change signed with an unknown key is refused. A change that arrives by email or on an invoice is ignored.

## Recovery

| Lost or stolen | Response |
|---|---|
| Agent key | Pause. Warden and the recovery key together replace the agent signer. The stolen key cannot pay alone or with the recovery key. |
| Warden key (lost) | The spending balance is frozen. Rebuild with a new spending account funded from reserves. |
| Warden key (stolen) | Pause. It cannot pay alone; a thief would need the agent key too. Move to a new spending account funded from reserves. |
| Agent and Warden keys | The spending balance is at risk up to its actual size. Pause, abandon the account, fund a new one from reserves. |
| Recovery key | Cannot pay alone or with the agent. Replace it through a reviewed signer-list change signed by Agent and Warden. |
| Supplier key | The supplier re-enrols through the full checks. Payments to it are held until then. |
| Operator login | Outside the ledger's protection. Mitigated by strong authentication and second-approver rules. |

Recovery steps will be tested on Testnet before they are claimed.

## Limits of supplier-signed records and credentials

- They do not stop a dishonest supplier from invoicing for goods it did not deliver. The delivery check does that.
- They are only as good as the identity check at enrolment.
- A compromised supplier can sign a change. The cooling-off period and out-of-band confirmation are the defence.
- They tell a bank nothing. A rand payout still depends on the partner's own checks.
- Credential metadata on the ledger is public. It must contain no personal or bank data.
- Between a credential being deleted and Warden's next ledger read, a payment could proceed. Warden reads the ledger immediately before signing to keep that gap short.
