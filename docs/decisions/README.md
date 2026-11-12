# Decision records

New records start from [TEMPLATE.md](TEMPLATE.md). Smaller decisions go in the [decision journal](../logs/DECISION-JOURNAL.md).

Each file records one decision: the context, the choice, and what it costs. A record is **Proposed** until the team agrees, then **Accepted**. Accepted records are reflected in [BUILD-BRIEF.md](../../BUILD-BRIEF.md).

| No. | Decision | Status |
|---|---|---|
| [0001](0001-supplier-anchored-reframe.md) | Lead with the South African supplier as first customer | Accepted |
| [0002](0002-plain-multisign-core.md) | Ordinary two-signature account as the core; delegation as a stretch goal | Accepted |
| [0003](0003-no-quantum-in-mvp.md) | No quantum features in the hackathon build | Accepted |
| [0004](0004-workshop-adjustments.md) | Ledger features to test after the Ripple workshop: signer matrix, trust line as exposure layer, credentials, simulate; delegation out of the critical path | Proposed (test plan) |
| [0005](0005-arduino-operator-hardware.md) | Warden Switch: Arduino one-way human veto, confirmed guard status, optional RFID (stretch, after Gates A and B) | Accepted as optional design; unbuilt/unverified |
| [0006](0006-model-boundary-and-providers.md) | Agent provider/model trust boundary, privacy safeguards and live-evaluation requirements | Proposed; measured only in simulated mode |
| [0007](0007-account-wide-serialization.md) | One unresolved payment per spending account until ledger reconciliation; simpler sequencing | Proposed — review required |
| [0008](0008-meta-full-provider-and-spend-cap.md) | Meta as a full provider, a hard spend cap in code ($10 total, $5 a day), and failover; partly supersedes [0006](0006-model-boundary-and-providers.md) (decisions 2, 4, 8) | Accepted (2026-11-12) |
