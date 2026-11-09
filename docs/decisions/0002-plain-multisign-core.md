# 0002: Ordinary two-signature account as the core

- **Status:** Proposed, 9 November 2026. Awaiting team sign-off.
- **Affects:** [BUILD-BRIEF.md](../../BUILD-BRIEF.md) "XRPL spike".

## Context

The build brief's main design gives a spending account's payment permission to a control account that needs two signatures (permission delegation plus multi-signing). Its fallback puts the two-signature rule directly on the spending account.

Permission delegation was reported as still disabled in August 2026 and eligible to activate only from 8 October ([Cryptoticker](https://cryptoticker.io/en/xrpl-permission-delegation-activation/), [Analytics Insight](https://www.analyticsinsight.net/xrp/how-xrpl-permission-delegation-could-change-crypto-wallet-management)). We have not checked its status on Testnet. There are four days and no code.

## Decision

Swap the order. Build the brief's fallback first, as the core:

- The spending account requires two signatures: the agent's and Warden's.
- The operator holds an offline recovery key.
- Warden is the only submitter.

Treat permission delegation as a stretch goal, attempted only after the core flow, the console and the attack suite work.

## Why

- Ordinary multi-signing is long established on the ledger, so the largest technical risk leaves the critical path.
- It still satisfies the track: limits are enforced outside the agent's control, and the rule is publicly checkable.
- Compared with Warden holding a single key, it costs about one extra setup transaction and survives the theft of either key alone.

## Costs

- Without delegation, the ledger does not restrict which transaction types the two signers can send together. Warden's rules must refuse anything that is not a plain payment, and the README must say this is enforced by Warden, not by the ledger.
- Less novelty for a judge looking for the newest ledger feature.

## Check before accepting

Run the ninety-minute Testnet check in the brief. If delegation with a multi-signing delegate works first time with RLUSD, the team may keep it as the core.
