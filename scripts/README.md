# scripts

Command-line tools. Run them through the npm scripts in the root `package.json` (see the root [README](../README.md#commands)).

| Path | npm script | What it does |
|---|---|---|
| `demo/run-demo.ts` | `npm run demo` | Starts the Warden, the agent and the console as three processes with separate identities, drops one fictional invoice and runs it end to end |
| `demo/prepare.ts` · `demo/enrol.ts` | `demo:prepare` · `demo:enrol` | Buyer records, Warden configuration and keys, agent identity, supplier enrolment (all outside the repository) |
| `demo/verify-tx.ts` | `demo:verify` | Reads one payment from Testnet: validated, result, delivered RLUSD and issuer, signer count |
| `demo/owner-notify.ts` · `demo/owner-email.ts` | (used by `demo`) | Owner notices to the console log, email and Telegram |
| `demo/ramp.ts` | (used by `demo`) | Kwacha-in quote and rand payout: SIMULATED, or a Paystack test-mode transfer |
| `demo/hosted-bundle.ts` | `demo:hosted-bundle` | Prepares invoices for the hosted Warden on Railway |
| `testnet/` | `testnet:*` | Provision accounts, set signer lists, fund RLUSD, single-key refusals, failover, high-value treasury, synthetic check |
| `attack-suite.ts` | `npm run attack` | The Warden attack suite ([ATTACK-SUITE.md](../docs/ATTACK-SUITE.md)) |
| `judge-check.ts` | `npm run judge:check` | One-command offline judge check |
| `secret-scan.ts` | `npm run secrets:scan` | Scans every tracked file for seeds, keys and tokens; also runs before each commit |
| `gen-invoices/` | `npm run gen:invoices` | Fictional South African invoice generator (seeded, reproducible) |
| `fx/` · `fx-demo.ts` | `fx:*` | FX quote demos, including an x402-paid FX quote |
| `spike/` | (none) | Throwaway experiments, kept for the record (for example the human co-signer spike, T-271/T-272) |

Every command that writes to the ledger works on **XRPL Testnet only** and keeps seeds in the local SignOff folder, never in the repository.
