# 0001: Lead with the South African supplier as first customer

- **Status:** Proposed, 9 November 2026. Awaiting team sign-off.
- **Affects:** [BUILD-BRIEF.md](../../BUILD-BRIEF.md) "Problem and user", the pitch, the demo story.

## Context

The build brief frames the user as a Lusaka solar distributor paying a South African supplier. That framing exists because the August 2026 draft manual bars South African resident companies from cross-border crypto transactions.

Judged against the rubric, the framing is weak on Business/Market Fit: the customer is fictional and outside South Africa, the judges sit in Cape Town, and the criterion asks for "African market problem identification" and "integration with local infrastructure". The underlying problem is large in South Africa; see [PROBLEM.md](../PROBLEM.md).

## Decision

Keep the payment flow: a buyer outside South Africa pays a South African supplier. Change who the product is sold to first and add one feature.

1. **First customer is the South African supplier.** It invites its buyers. One wholesaler brings many accounts.
2. **Supplier-signed payout record.** The supplier publishes its payout details once, signed with its own key. Warden checks every payment against it. A change needs the supplier's key and a cooling-off period.
3. **Local infrastructure on the page.** Bank account verification, accounting links and rand payout through a licensed partner appear in the demo, each labelled simulated.

## Why

- It makes the South African business the hero of the story without asking a resident company to hold crypto.
- It removes the fraud at its source. An email can no longer change where money goes.
- It gives a go-to-market path and a network effect: the register of signed payout records.

## Costs and risks

- The supplier record is new scope. For the hackathon it can be a signed record held by Warden, with ledger anchoring as a stretch.
- The legal reading is ours, not a lawyer's.
- It still depends on a payout partner nobody has contacted.
- It changes an agreed brief four days before the deadline.

## If rejected

The Lusaka framing in the build brief stands. The evidence in [PROBLEM.md](../PROBLEM.md) still supports the pitch.
