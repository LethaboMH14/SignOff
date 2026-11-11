# SIGNOFF / THE FINAL SAY — Arduino judge demonstration runbook

**Proposed concept, not implemented or tested · 10 November 2026**  
Owner: SignOff team · Source: [ADR 0005](decisions/0005-arduino-operator-hardware.md) · Dependencies: [Engineering Gates A and B](ENGINEERING.md#delivery-gates)

> **The one line:** “The AI can ask. The ledger needs two signatures. And a finance officer can stop the next signature with one button.”

This document is a **physical demonstration concept** for SignOff's existing Arduino Uno R3, not proof that a device, bridge, Warden endpoint, XRPL transfer, scanner or enclosure has been built. Judges should remember the *control they saw working* rather than an untestable claim about AI.

## 1. Stage identity: the Warden Switch

**Front-facing design:** a small desk object labeled **SIGNOFF / THE FINAL SAY**, with one unmistakable large red **STOP NEW PAYMENTS** control and an unobstructed status indicator. If available from safe, existing materials, use a clean matte-black or midnight-blue base, white legible lettering and a clearly marked **USB DEMO** connector; avoid promising a manufactured enclosure. No fragile moving parts or unsafe electrical modifications are necessary.

**Two different questions, never conflated:**

- **GUARD state:** **ACTIVE / PAUSED / CONNECTION UNKNOWN**, obtained from Warden, not guessed from a microcontroller LED. The stop button requests **PAUSED** only. Resume is *not* controlled by this button.
- **PAYMENT state:** **HELD / AWAITING WARDEN / VALIDATED ON XRPL / RECONCILIATION UNKNOWN**. The **green “VALIDATED ON XRPL”** indication is shown **only** after the reconciler confirms a transaction on a validated ledger with the expected amount. It never means supplier bank credit; ZAR payout remains **SIMULATED**.

If hardware limits allow only one RGB LED, show a **prominently labeled current guard state** and mirror the richer per-invoice state on the laptop console. Do not silently overload one green light to mean both “safe to pay” and “money arrived.” Use words/shapes in the console so red/green color vision is not essential.

## 2. The memorable 90-second sequence

This sequence is a **script for a rehearsal**, not a factual report of a completed demonstration. It should be timed with actual functioning software and backed by a prerecorded *honestly labeled* run.

| Elapsed | Show (one action at a time) | Say to judges | Evidence that must actually exist |
|---|---|---|---|
| 0–12 s | Physical Warden Switch next to the operator desk; show invoice and verified vendor record | “This AI can prepare a payment, but it can't pay by itself.” | Real source-cited extraction and separate Warden service |
| 12–28 s | Clean invoice → independent PO and receipt match → Testnet multi-sign → **VALIDATED ON XRPL** with QR/short explorer URL | “The second signature is an independent finance rulebook. Here is the ledger proof.” | Actual matching validated Testnet hash, amount and signer-list proof |
| 28–43 s | Present a second *fictional* invoice with an altered destination → **HELD / PAYEE CHANGED**; visible evidence path stops | “A believable-looking invoice isn't permission to change where money goes.” | Real deterministic hold and unchanged destination record |
| 43–62 s | With a **fresh eligible but not-yet-signed proposal** queued, invite a judge to press the red button → guard says **PAUSED** → Warden refuses the new signature | “You are now the finance officer. Press it. The model can keep talking, but no new Warden signature is issued.” | Warden-confirmed pause ACK and subsequent rejected/held authorization, timed event IDs |
| 62–77 s | Turn off or unplug the hardware bridge **while hardware guard is armed**; Warden remains paused/auto-pauses by heartbeat expiry; laptop displays reason | “If the controller loses contact, we fail safely instead of guessing.” | Tested watchdog/lease and loss-of-link test; otherwise **skip this beat** and disclose limitation |
| 77–90 s | Show evidence timeline: invoice hash → verified supplier → policy → Warden decision → XRPL receipt/hold. Operator-only reactivation outside the button | “Every refusal and every payment has an auditable reason. AI proposes. Finance controls. XRPL verifies.” | Exported audit trace, not a graphic-only mockup |

**Optional warehouse moment (only after the above works):** a known tagged box is scanned; the receipt shows **TAG PRESENTED → AWAITING RECEIVER APPROVAL**. A real receiving operator approves the fixture, enabling a three-way match later. **Never** let an RFID scan by itself mark goods delivered or authorize payment. If scanner hardware is absent, use a clearly labeled simulated receiving record in the console; don't add a fake scan.

**Judging narrative:** demonstrate a genuine capability, an actual failure correctly contained, human override outside the agent, and independently inspectable evidence. No judges can be forced to award a win; credibility and a working sequence are the objective.

## 3. Control invariants: safety before theatrics

1. **STOP is one-way:** a hardware press can request **PAUSE NEW WARDEN AUTHORIZATIONS** only. A second press **must not resume**. Resuming requires an authenticated operator action with the configured authorization checks, logged reason and policy version.
2. **The pause is prospective:** it prevents future Warden co-signatures. It **cannot** cancel a transaction already fully signed/submitted to XRPL. Reconciler must continue tracking in-flight transactions while paused.
3. **Separate short-lived capability:** the laptop bridge, if used, receives only short-lived, narrowly scoped **pause/status** permissions after operator authentication. Never put a broad operator login, signing key, issuer secret, reserve key or durable credential on the Uno or in Arduino serial traffic. Do not store long-lived tokens on an unsecured bridge.
4. **Acknowledged status:** the LED does **not** turn “PAUSED” solely because the Uno saw a button press. It changes when Warden acknowledges and returns a signed/authenticated or transport-protected current state. If confirmation fails, show **UNKNOWN / STOP NOT CONFIRMED**, raise an alert and rely on the independent Warden fail-closed policy.
5. **Hardware-armed watchdog:** only if the hardware guard mode is **explicitly enabled and tested**, Warden grants a short-lived heartbeat lease to the bridge. Missing renewal/USB loss → **new authorization requests fail closed** and a durable event records the cause. The exact lease threshold is tested, not invented. The system may run *without* Arduino in normal demo mode only when Warden is deliberately configured not to rely on hardware, with separate operator controls still available; it must not silently switch from armed to unarmed after cable loss.
6. **Events are attributable:** log actor and device ID, request ID, lease state, UTC/SAST timestamps, previous/next state, operator who resumed, reason, policy version and whether any in-flight transfer was already submitted. The Arduino device ID alone is **not** an authentication factor.
7. **RFID is untrusted:** a cheap tag proves at most presentation of a clonable identifier. Only a separately authenticated receiving officer can accept goods into the authoritative goods-received record. No payment keys or sensitive buyer/supplier details are placed on the tag.
8. **No fabricated success:** no green before validated settlement. A UI demo, offline fixture, or recorded backup must be visibly labeled **SIMULATED** if not reflecting a live validated transaction. Avoid LEDs driven directly by optimistic model decisions.
9. **Graceful dependency failure:** Warden is independently deployed and must continue its policy even if the laptop, bridge, Uno, browser or model API fails. Once the hardware guard is armed, loss of its heartbeat blocks new authorizations. Do not portray the USB button as a production-grade physical emergency stop unless this behavior has been built and tested.

### Minimal state protocol (concept only)

```text
Arduino via USB serial:
  PAUSE_REQUEST {event_id}                  # no secrets
  CONNECTED / STATUS_LIGHT_REQUEST          # indication, not an authority

Laptop bridge -> Warden (authenticated, pause-only scope):
  POST /v1/operator/pause {event_id, reason:"HARDWARE_BUTTON"}
  GET  /v1/operator/guard-status
  POST /v1/operator/hardware-lease/renew     # only if guard explicitly armed

Warden -> bridge -> Arduino:
  GUARD_STATE {ACTIVE|PAUSED|UNKNOWN, event_id}
  PAYMENT_STATE {HELD|AWAITING|VALIDATED|UNKNOWN, invoice_ref}

Resume: **operator portal only**, not a serial/Arduino command.
```

The sketch is a conceptual boundary specification; do not implement the names above as an unauthenticated endpoint. In production, request signing/identity, replay prevention, CSRF/browser considerations, audit and least privilege need formal review.

## 4. Demo setup and test evidence gate

| Test | Required observation |
|---|---|
| T1: STOP with browser closed | Warden confirms PAUSED via independent bridge; next fresh eligible proposal receives HOLD |
| T2: press STOP twice | Still PAUSED. Neither press resumes. |
| T3: resume from authorized operator path | Required human authorization checked; state change logged; fresh proposals may proceed again |
| T4: send STOP while transaction already submitted | No new signatures; previously submitted transaction still reconciled without any claim of cancellation |
| T5: unplug USB while armed | Heartbeat expires; Warden refuses new authorizations; loss logged; no automatic downgrade to unarmed |
| T6: bridge/Warden/network unavailable | Unknown state displayed; no false green/paused ACK; Warden fails closed |
| T7: normal paid event | Green/“VALIDATED ON XRPL” only with the actual validated hash and delivered amount |
| T8: changed payee | Amber/“HELD” and a readable independent rule reason; never substitutes destination |
| T9: clone/unknown RFID tag | No automated receipt approval or payment; event is held/reviewed |
| T10: device removed | Console and Warden remain usable under their own independently authenticated policy; hardware watchdog behavior depends on deliberately armed/unarmed state |

For every claimed test, record **expected, actual, source commit, Warden event ID, operator state, Testnet hash if relevant, timestamp, and pass/fail**. An unperformed test has state **NOT RUN**, not PASS. Avoid publishing credentials or private supplier records.

## 5. Minimum scope and decisions

**Only pursue after Gate A (genuine multisign Testnet proof) and Gate B (deterministic Warden/holds) pass.** Preferred hardware order: **STOP button → unambiguous confirmed state → judge story**. RFID is a later bonus, not a blocker. Use simple, low-voltage, existing starter components and a safe off-the-shelf USB connection. Confirm actual available parts and platform support before committing to the story.

**Go/no-go:** If basic 2-signature payment, hold and independent pause do not work, omit the physical demo and show a truthful software-only demo with a recorded fallback. A decorative Arduino with scripted lights does **not** count as product evidence.

**Suggested headline:** **“SignOff: the AI proposes. The Warden decides. The ledger proves.”**

## 6. Judge-facing evidence handout

One screen or small QR handout should link to (i) a valid XRPL Testnet transaction, (ii) a Warden refusal with evidence reference, (iii) a pause event linked to the physical button, (iv) the test matrix and actual run logs, and (v) the exact GitHub commit. These URLs should be populated from *real results only*, not placeholders presented as facts. A QR code is optional; a short plain URL also works.

**Security boundary:** The hardware demonstrates an independently enforced human veto. It does not replace supplier KYB, authorization, segregation of duties, ledger finality, audit controls or legal review.

**Recorded state:** No implementation, validated XRPL hash, hardware test or customer evidence is claimed by this document.
