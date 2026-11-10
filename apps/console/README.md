# apps/console

The operator console. Built so far: the payment desk with sign-in (D1), and the live agent map (D8). Not built yet: the held-invoice view (D2), limit and pause controls with the second approver in the console (D3), and the receipt (D4). See [ISSUES.md](../../docs/ISSUES.md).

## The payment desk

The first screen after sign-in. It shows the Warden's state (running or paused, the limits, today's usage, and any raised limit waiting for a second operator) and a queue of invoices, each with its state and the plain reason.

- **Paid** appears only when the Warden attempt is paid, the ledger result is validated, and the agent has recorded reconciliation. A paid attempt that fails either check is shown as **Not confirmed**.
- **Every state has words and a symbol.** The symbol is hidden from assistive technology, and colour is never the only signal.
- **Reasons come from codes.** Each reason is fixed text keyed by its reason code. A code with no text is shown as its code, never as an invented sentence. The texts are drafts until they are reviewed.
- **Simulated runs are labelled.** A replay says SIMULATED on the screen.
- **Changes need the password again.** A pause, a resume or a limit change asks for the password if the last confirmation is more than five minutes old.

The desk reads the Warden's operator views and the agent's transition log. It shows the agent's model-call count for each invoice (at most three).

## Operators and sign-in

Each person has an account with a password (stored as a scrypt hash) and one of two roles:

- **operator** can pause, resume, change limits and approve a raised limit. Each operator has their own Warden principal, so two approvals are two people.
- **viewer** can read the desk and nothing else.

Five failed sign-ins for one name lock that name for fifteen minutes. A session ends after thirty minutes without a request, or after eight hours. The browser holds only an HttpOnly cookie and a form token; it never holds a key.

### Create an account

The operator file lives outside the repository (by default in the local SignOff folder, under `console/operators.json`). Use the command from the repository root. The password is read from standard input, or from a file you name with `--password-file`. It is never put on the command line.

```bash
npm run console:operator -- add alice operator --principal operator-alice --secret-file <path to a file holding the Warden secret>
```

```bash
npm run console:operator -- add vera viewer
```

```bash
npm run console:operator -- list
```

An operator's Warden secret is base64 of at least 32 random bytes, kept in its own file outside the repository. Add the same principal id and secret to the Warden's keys file, so the Warden accepts that person's requests. Generate a secret once, for example with `openssl rand -base64 32 > <file>`, and keep the file private.

## Run it

Build the web app once:

```bash
npm run build -w @signoff/console
```

Start the server on the replay, with the Warden it should call:

```bash
SIGNOFF_WARDEN_URL=http://127.0.0.1:8080 SIGNOFF_CONSOLE_MODE=simulated SIGNOFF_CONSOLE_TRANSITIONS=apps/console/fixtures/simulated-transitions.jsonl npm run console:serve
```

For a live run, point it at the agent's log and set the mode to `live`:

```bash
SIGNOFF_WARDEN_URL=http://127.0.0.1:8080 SIGNOFF_CONSOLE_MODE=live SIGNOFF_CONSOLE_TRANSITIONS=apps/agent/state/agent-log.jsonl npm run console:serve
```

Then open http://127.0.0.1:4180 and sign in.

| Variable | Default | Meaning |
|---|---|---|
| `SIGNOFF_WARDEN_URL` | none (required) | The Warden's address. The console refuses to start without it. |
| `SIGNOFF_CONSOLE_OPERATORS` | `console/operators.json` in the local SignOff folder | The operator file. It must be outside the repository. |
| `SIGNOFF_WARDEN_READER_ID` and `SIGNOFF_WARDEN_READER_SECRET_FILE` | none | An optional read-only Warden principal for viewers. Without it, viewers see no desk. |
| `SIGNOFF_CONSOLE_MODE` | `live` | `simulated` or `live`. Shown on the page. |
| `SIGNOFF_CONSOLE_TRANSITIONS` | `apps/agent/state/agent-log.jsonl` | The agent's transition log to read. |
| `SIGNOFF_CONSOLE_PORT` | `4180` | The port. |
| `SIGNOFF_CONSOLE_HOST` | `127.0.0.1` | Only a loopback address is accepted. |

In development, `npm run dev -w @signoff/console` serves the page with hot reload and proxies `/api` to the server.

## The agent map

An animated map of invoices moving between the agents as the agent works on them. Each token is one invoice. It moves to the agent that has just acted on it. Held moves leave the main lane. Paid appears only for a reconciled move, and the feed gives the plain reason for each hold.

- **Source.** The agent's transition log, one JSON object per line. The console reads it and never writes to it.
- **Transport.** Server-sent events on the loopback address. The browser reconnects by itself and resumes from the last move it saw. The stream requires a signed-in session.
- **What the browser receives.** The state, the agent, the time, the first eight characters of the invoice's correlation id and the reason code. Evidence hashes, attempt and obligation identifiers, and reason text from documents are not sent.
- **Replay.** `fixtures/simulated-transitions.jsonl` replays the 30-case labelled set. It is labelled SIMULATED. It was made by the evaluation with `--transitions`, so it has no Warden, ledger or paid moves.

## Security

The console never writes to the agent's log, binds to the loopback address only, and serves files only from the built web folder. Every response carries a Content-Security-Policy, `nosniff`, frame denial, `no-referrer` and `no-store`. Every API route checks, in order, the session, the role, the origin, the form token, a recent password confirmation where one is needed, and only then the body. Refusals name the failed check and nothing else. The Warden's views are read through an allowlist, so a new field in a Warden view does not reach the browser. See [SECURITY-LOG.md](../../docs/logs/SECURITY-LOG.md) T-37 to T-40 and S-041, S-043.

## What is not claimed

- The replay is simulated. A live run with the Warden has not run, so no ledger or paid move has been shown on this desk or this map.
- The reason texts are drafts: fixed text per code, not yet reviewed.
- The desk's daily chart from the mockups is not built.
- The phone layout was measured in the built-in browser before the model-call line was added; the final build's phone check is not yet recorded. No accessibility scan has been run (D5).
- Sign-in has not been tested with a real operator account on a shared machine, and the console is not deployed (D6).

## Tests

```bash
npx vitest run apps/console
```

The suite covers the display-state table, the reason catalogue, the desk rows, the sign-in and sessions, the operator file, the API's refusals and redaction, the Warden views, the browser's rendering of the desk and sign-in, the agent's lists, the move mapping, the board reducer, the layout, the log tail, the server's stream and headers, and the rendered map and feed.
