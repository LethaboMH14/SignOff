# 0005: SignOff Warden Switch — an Arduino finance veto judges can see

- **Status:** Accepted as an optional *design direction*, 10 November 2026; **not built, approved for production use, or demonstrated**.
- **Scope:** Strict stretch, only after [Engineering Gates A and B](../ENGINEERING.md#delivery-gates) work. Time-box only after the live payment and holds are proven; drop hardware if it threatens submission reliability.
- **Hardware:** proposed Arduino Uno R3 starter set; confirm available parts before coding. No network credentials or signing keys on the board.
- **Full runbook, 90-second story, threat model and test matrix:** [ARDUINO-JUDGE-DEMO-RUNBOOK.md](../ARDUINO-JUDGE-DEMO-RUNBOOK.md).

## Why this should exist

The judges should **see a human veto that is outside the AI**. A physical button can be a memorable way to prove that the agent is not in charge of spending money. The effect must be real and verifiable, not a theatrical light cue.

**Judging line:** **“The AI proposes. The Warden decides. The ledger proves.”**

The hardware is **not** the financial control. The independently deployed Warden and the on-ledger two-signature requirement are the control. The device is one operator interface that can **request a new-authorizations pause**, while a laptop console and the independent Warden route remain available.

## Design decision and order

1. **One-way large red STOP NEW PAYMENTS button.** Pressing requests a Warden pause. Repeated presses never resume. Only authenticated human action through an independent operator route can resume; the action is logged and subjected to the relevant approvals.
2. **Clear guard-status indication.** Display the Warden-confirmed **ACTIVE**, **PAUSED** or **CONNECTION UNKNOWN** state. Do not claim “paused” when the bridge merely transmitted a request. The device should be labeled so observers understand which is which.
3. **Separate payment-status indication.** **HELD**, **PENDING / AWAITING WARDEN**, **VALIDATED ON XRPL** or **RECONCILIATION UNKNOWN**, obtained from trusted Warden/reconciler events. Green must refer only to actually validated XRPL settlement, *not* a simulated supplier's bank credit.
4. **Optional warehouse RFID demonstration, last.** A scanner event is only **TAG PRESENTED**. A separate authenticated receiving officer must approve a goods-received record. Cheap RFID identifiers can be cloned; a scan is not proof of goods quality, delivery or permission to pay.

Use accessible labels/icons alongside LED colors. A compact dark presentation base and legible status placard improve stage impact without requiring new fabrication or unsafe electrical work. Do not compromise the live flow for a decorative enclosure.

## Trust boundaries

\`\`\`mermaid
flowchart LR
  A["STOP button / LEDs on Uno"] <-->|"USB serial: no secrets"| B["Operator laptop bridge"]
  B -->|"Authenticated pause-only command"| W["Independent Warden"]
  B -->|"Armed-mode heartbeat"| W
  W -->|"Confirmed state"| B
  W -->|"Hold / no new signature"| X["Payment workflow"]
  R["Validated XRPL reconciler"] -->|"Verified payment state"| B
\`\`\`

- The Uno R3 has no built-in networking or secure key storage. Keep all XRPL, reserve, issuer and operator signing secrets off the device; do not embed long-lived secrets in sketch, serial messages, source or demo logs.
- The bridge must not have broad finance-admin permissions. Grant a **short-lived narrowly scoped pause/status capability** on an authenticated operator session; **never** grant resume or transaction signing authority to the Arduino bridge.
- The **hardware guard is optional but explicit**: when Warden is armed to rely on device availability, it requires the bridge heartbeat to stay fresh; missing renewal or unplugged USB makes Warden **fail closed for new co-signatures**. The safety behavior must be implemented on the server and tested before claimed. An unarmed software-only mode is permitted only as a deliberate authenticated configuration—not as an automatic fallback after losing the device.
- Confirmation of PAUSED must come from Warden, not local button logic. If state is unconfirmed, show **CONNECTION UNKNOWN / STOP NOT CONFIRMED**; Warden's independent controls remain authoritative.
- **Pause is not blockchain reversal.** It stops *new Warden authorizations*. It cannot claw back a transaction already signed/submitted; those transactions still need reliable reconciliation.
- The operator console may be closed during the demo. The laptop bridge uses an independently authenticated Warden endpoint. Warden enforces the same policies if the entire laptop goes away.

## The judge-visible demonstration

After a real validated Testnet payment is shown, stage a fictional changed-bank-details invoice → Warden **HELD**. Then queue a *new* clean invoice that is still awaiting authorization and invite a judge to press **STOP**. Show the **Warden-confirmed PAUSED event** and prove that the new payment does **not receive a second signature**. Finally show the evidence trail with the validated transaction hash and held proposal reason. If implemented and rehearsed, disconnect the armed bridge to demonstrate server-side fail-closed behavior. Do not fake this test if the guard is not built.

**Demo script and evidence protocol:** [runbook](../ARDUINO-JUDGE-DEMO-RUNBOOK.md).

## Acceptance matrix (NOT RUN until evidence exists)

| Test | Expected |
|---|---|
| Press button with console closed | Warden logs a PAUSE event; new eligible proposal is HELD |
| Press twice | System remains PAUSED; hardware never resumes |
| Authenticated operator resumes | Server checks authorization; logs operator and reason |
| Lose USB/bridge while hardware guard armed | New signatures blocked by server watchdog after lease expiry |
| Disconnect hardware while unarmed | Software-only Warden controls remain active; explicit mode shown |
| Press after a payment has already been submitted | No new signature; submitted payment still reconciled, not “cancelled” |
| Changed supplier payout detail | Hold; status reflects real Warden reason |
| Warden/network acknowledgement unavailable | Unknown/failed indicator; no false green or paused ACK |
| Validated Testnet payment | Payment indicator updates only after real validated ledger result with correct amount |
| Scan duplicate, unknown or cloned RFID | No independent authority to mark delivery/pay; receiving approval required |

Each *executed* test needs trace, commit, timestamp, policy, expected, actual and ledger hash where relevant. **Until tested, all rows are proposed**.

## Decision and costs

**Accept the memorable hardware concept, not an untested security guarantee.** The stage effect is worth pursuing only if the payment control system already works. The ROI is a vivid, judge-understandable proof of “human authority outside an AI agent”; the cost is a new bridge, serial connection and failure mode. An honestly labeled software demo is preferable to an unreliable physical prop.

**No promise of a hackathon win:** judges decide. We optimize for a memorable demonstration supported by actual technical evidence.
