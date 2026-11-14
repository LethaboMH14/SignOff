# apps/warden

The Warden is the independent rules service on the payment path. It holds its own signing key, reads the ledger before it signs, and co-signs only the one payment shape it builds itself. It runs as its own process, with its own directory, keys, configuration and evidence file, and it is separate from the agent ([TRUST.md](../../docs/TRUST.md)).

## Status

Gate B, [ISSUES.md](../../docs/ISSUES.md) B1 to B9: implemented and tested, in review. The unit and integration tests run on a simulated in-memory ledger. Live evidence on the XRP Ledger Testnet uses a test-issued token, not RLUSD: [TEST-LOG T-071](../../docs/logs/TEST-LOG.md) and [T-072](../../docs/logs/TEST-LOG.md). The RLUSD path waits for funding (A3). The Warden is not deployed, and there is no console yet.

## Run it

The Warden's directory is outside the repository, under the user profile, and it reads the Gate A registry through the Gate B driver:

```bash
npm run testnet:gate-b -- prepare
npm run warden:serve
```

With the Warden running, `npm run testnet:gate-b -- b1` and `npm run testnet:gate-b -- b8` exercise it over HTTP, as the agent and the operators do. Each prints one line per check, with the decision, the result code and any transaction hash. Nothing printed holds an address or a seed.

## Test it

```bash
npm test
```

The tests cover each rule in B1 to B9 for its accepting and refusing cases, request authentication, the event log and its replay, the payment guard, the pre-signing checks, the HTTP surface and the client.

## Limits

These are recorded in [SECURITY-LOG.md](../../docs/logs/SECURITY-LOG.md) and [DECISION-JOURNAL.md](../../docs/logs/DECISION-JOURNAL.md) (D-060): the request secrets are held in a form the Warden can verify with; a forced stop leaves the directory lock until an operator removes it; the event log is not hash-chained; one operator can still raise a limit until Gate D; and the destination's trust line limit is checked by the ledger, not before signing.
