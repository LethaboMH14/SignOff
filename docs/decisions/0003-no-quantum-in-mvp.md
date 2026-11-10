# 0003: No quantum features in the hackathon build

- **Status:** Accepted, 10 November 2026, in review of pull request 1. Proposed 9 November 2026.

## Context

We asked whether quantum finance or quantum cryptography could strengthen the project.

| Idea | What it is | Fit |
|---|---|---|
| Quantum finance | Quantum algorithms for pricing, portfolios and risk simulation | None. Warden's rules are simple comparisons. |
| Quantum key distribution | Sending keys over special optical hardware | None. It needs physical links. |
| Post-quantum signatures | Software signatures designed to survive a future quantum computer | Real, but small |

The historical plan already lists "quantum" among the things to drop from earlier projects.

## Decision

Build nothing quantum for the hackathon. Keep one sentence for the roadmap: keys can be rotated to quantum-safe signatures when the ledger supports them, and audit evidence is hash-anchored.

## Why

- Two thirds of the score is product and business. A quantum label that does not survive one question costs credibility.
- Ripple has published a plan targeting post-quantum readiness by 2028, and a quantum-safe scheme has run on a test network since December 2025. Nothing is live on the main network, and one source disputes that 2028 is an official date ([crypto.news](https://crypto.news/ripple-plans-quantum-resistant-xrp-ledger-by-2028/), [Quantum Zeitgeist](https://quantumzeitgeist.com/?p=352460)).
- An XRPL account can change its signers without changing its address, so the design can adopt new signatures without moving customers.
- Hashes are far less exposed to quantum attack than today's signatures, and SignOff anchors hashes.

## Stretch, only after everything else works

Sign the supplier payout record with both a normal signature and a quantum-safe one. That record lives in our own software, so the ledger does not limit it. The library choice is unverified, and quantum-safe signatures are reported to be roughly 40 times larger.

## Conditions of acceptance (10 November 2026)

Keep the scope on demonstrable finance controls, operator experience and business validation.
