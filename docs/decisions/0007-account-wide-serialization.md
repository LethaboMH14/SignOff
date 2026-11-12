# ADR 0007 — one unresolved ledger payment per spending account

- **Status:** Proposed, 11 November 2026 — requires independent Sibusiso review and CI before acceptance
- **Scope:** Gate B MVP, one Warden service instance per controlled spending account
- **Issue:** [#29](https://github.com/LethaboMH14/SignOff/issues/29)
- **Implementation PR:** [#52](https://github.com/LethaboMH14/SignOff/pull/52)

## Context

The original [BUILD-BRIEF](../../BUILD-BRIEF.md) says **one unresolved payment per spending account**. An early B2 implementation reserved one unresolved attempt *per payable*, which permits multiple different invoices to be in flight with the same XRP Ledger account sequence. That can create confusing `tefPAST_SEQ`, reservations and retry races.

## Decision proposed

Keep the existing stable buyer-scoped payable key and duplicate detection, but permit **only one unresolved transaction across different payables** at a time for the same spending account. The next invoice waits with a clear HOLD until the active attempt is paid, explicitly rejected, or has expired after reliable ledger reconciliation.

A duplicate of the same payable still gets the more precise `DUPLICATE` reason. Missing evidence, changed payees, and over-limit proposals still get their own precise reason before the per-account sequencing HOLD.

The Warden event log preserves the reservation across restart; do not clear a pending attempt merely because a request timed out. The final authorization step still checks current ledger and policy state immediately before Warden signs.

## Limitations and risks

- **Throughput trade-off:** one account processes at most one unsettled payment at a time, intentionally simplifying the hackathon build. Scaling later requires proven sequence assignment/reservation, durable database locking, and recovery semantics.
- **Single-instance assumption:** the in-memory `exclusive()` queue is process-local. Production multi-instance deployments require an atomic shared ledger/account lock. The code is **not** approved for multiple Warden replicas sharing a spending account.
- **Hold vs cancellation:** a transaction already fully signed and broadcast is not reversed by a new pause. The reconciler must continue until it knows the final ledger outcome.
- **Evidence:** CI passing on PR #52 validates offline race/sequence tests; it is not independent live RLUSD Testnet proof. The required RLUSD transaction remains open in issue #22.

## Acceptance

- Concurrent invoices for *different* payables cannot both obtain a new pending authorization.
- Same-payable duplicates remain identified and held.
- After the first payment is finalized, the second payable can proceed.
- Expired/submitting attempts are reconciled, never silently discarded.
- Existing B5 limit and B3 payee checks keep their more specific HOLD classifications.
- Independent code review, CI and, before Gate B phase-close, an actual Testnet sequence/race demonstration.
