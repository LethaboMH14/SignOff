# apps/console

The operator console. Built so far: the live agent map (D8). Not built yet: the payment desk, the held-invoice view, limits and pause controls, and the receipt (D1 to D4, see [ISSUES.md](../../docs/ISSUES.md)).

## The agent map

An animated map of invoices moving between the agents as the agent works on them. Each token is one invoice. It moves to the agent that has just acted on it. Held moves leave the main lane. Paid appears only for a reconciled move, and the feed gives the plain reason for each hold.

- **Source.** The agent's transition log, one JSON object per line. The console reads it and never writes to it.
- **Transport.** Server-sent events on the loopback address. The browser reconnects by itself and resumes from the last move it saw.
- **What the browser receives.** The state, the agent, the time, the first eight characters of the invoice's correlation id and the reason code. Evidence hashes, attempt and obligation identifiers, and reason text from documents are not sent.
- **Replay.** `fixtures/simulated-transitions.jsonl` replays the 30-case labelled set. It is labelled SIMULATED. It was made by the evaluation with `--transitions`, so it has no Warden, ledger or paid moves.

## Run it

Build the web app once:

```bash
npm run build -w @signoff/console
```

Start the server on the replay:

```bash
SIGNOFF_CONSOLE_MODE=simulated SIGNOFF_CONSOLE_TRANSITIONS=apps/console/fixtures/simulated-transitions.jsonl npm run serve -w @signoff/console
```

For a live run, point it at the agent's log and set the mode to `live`:

```bash
SIGNOFF_CONSOLE_MODE=live SIGNOFF_CONSOLE_TRANSITIONS=apps/agent/state/agent-log.jsonl npm run serve -w @signoff/console
```

Then open http://127.0.0.1:4180.

| Variable | Default | Meaning |
|---|---|---|
| `SIGNOFF_CONSOLE_MODE` | `live` | `simulated` or `live`. Shown on the page. |
| `SIGNOFF_CONSOLE_TRANSITIONS` | `apps/agent/state/agent-log.jsonl` | The agent's transition log to read. |
| `SIGNOFF_CONSOLE_PORT` | `4180` | The port. |
| `SIGNOFF_CONSOLE_HOST` | `127.0.0.1` | Only a loopback address is accepted. |

In development, `npm run dev -w @signoff/console` serves the page with hot reload and proxies `/api` to the server.

## Security

The console has one read path and no write path. It binds to the loopback address only. Every response carries a Content-Security-Policy, `nosniff`, frame denial, `no-referrer` and `no-store`. Files are served only from the built web folder. See [SECURITY-LOG.md](../../docs/logs/SECURITY-LOG.md) T-37 and S-041.

## What is not claimed

- The replay is simulated. A live run with the Warden has not run, so no ledger or paid move has been shown on this map.
- The reason texts are drafted, fixed text per code, and need review. A code without text is shown as its code.
- The map was checked in the browser at desktop width. The phone layout and the motion timing have not been checked by eye.

## Tests

```bash
npx vitest run apps/console
```

The suite covers the browser's lists against the agent's, the move mapping, the board reducer, the layout, the log tail, the server's stream and headers, and the rendered map and feed.
