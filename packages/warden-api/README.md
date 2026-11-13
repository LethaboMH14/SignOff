# packages/warden-api (`@signoff/warden-api`)

The Warden's wire contract. The Warden and every caller (the agent, the console, the operator commands) import from here, so both sides of the HTTP API agree on one definition.

| File | What it holds |
|---|---|
| `src/contract.ts` | Request and result types for proposals, operator views and controls |
| `src/signing.ts` | Request signing: each caller has its own principal and secret, and the Warden refuses any unsigned or stale request |
| `src/client.ts` | The caller client the agent and the console use, for example `POST /v1/proposals` |

The agent's only write call is a payment proposal. It never receives a usable Warden signature: the Warden signs only at final authorization, after rechecking pause, policy, limits, payee and the ledger ([TRUST.md](../../docs/TRUST.md)).

Tests: `npx vitest run packages/warden-api`.
