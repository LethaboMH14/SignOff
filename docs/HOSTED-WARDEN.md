# Hosted Warden on Railway

The Warden runs on its own host, away from the agent and the console: Railway project `signoff-warden`, service
`warden`, at https://warden-production-4f0fcb91.up.railway.app. It holds the Warden's key on its own disk. The agent and
the console stay on the operator's machine and reach it over HTTPS with their signed requests. First paid invoice
through it: TEST-LOG T-268. Testnet only; Testnet RLUSD has no real value.

## What runs where

| Part | Where | Holds |
|---|---|---|
| Warden | Railway, one replica, a volume at `/data` | The Warden key, its configuration, callers, buyer evidence, event log and payment journal |
| Agent, console, mail watcher | The operator's machine (`npm run demo -- --email --warden-url …`) | The agent key, the model key, the mailbox app password |

`/v1/health` answers without authentication and holds nothing secret. Proposals, operator views and control routes
answer 401 without a signed request (checked on 13 November).

## How it was set up

1. `npm run demo:hosted-bundle` writes a batch of fictional clean invoices to the outbox with their order and receipt
   records, then packs the local Warden folder into one value, with the listen address changed to `0.0.0.0:8080`. The
   value is written outside the repository (`%LOCALAPPDATA%\SignOff\testnet\hosted\warden-bundle.b64`); only its path
   and size are printed.
2. Railway: project and service created with the CLI, `PORT=8080`, a volume at `/data`, and
   `RAILWAY_DOCKERFILE_PATH=deploy/warden/Dockerfile.railway` (without it Railway ignored `railway.json` and tried its
   own builder, which failed).
3. The operator pasted the bundle into the service variable `SIGNOFF_WARDEN_BUNDLE` in the Railway dashboard. The key
   never passed through chat or the repository.
4. `railway up --service warden` uploads the working tree (git-ignored files such as `.env` are left out) and builds
   the image. On its first start `deploy/warden/railway-start.mjs` writes the six Warden files to the volume, never
   overwriting files already there, removes a stale `run.lock`, and starts the Warden without the bundle variable.
5. `railway domain --port 8080` gives the public HTTPS address.

## Running the demo against it

```powershell
$env:LOCALAPPDATA = "C:\Users\Dell Latitude\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local"
npm run demo -- --email --warden-url https://warden-production-4f0fcb91.up.railway.app
```

Then email one of the invoices that step 1 put in the outbox. Rules that keep it safe:

- **One Warden at a time.** The launcher refuses to start if a local Warden answers. Both would sign for the same
  spending account.
- **Only prepared invoices.** The hosted Warden knows only the records in its bundle. A new invoice made on this
  machine (the desk's "Send a test invoice", which this mode turns off, or a plain `npm run demo`) would be held for
  missing evidence. To add invoices, a new bundle and a fresh volume are needed.
- **State is split.** The hosted Warden's log starts from the bundle; the local Warden's log stops there. Do not switch
  back to the local Warden and re-send an invoice the hosted one already paid.

## Limits

- The key sits on a Railway volume, not in a key service (P2). Railway staff and anyone with access to the project can
  reach it.
- Railway trial: 30 days or USD 5.00, whichever ends first.
- No alerts or uptime monitoring (P4). Restart policy: on failure, five retries.
- The agent still runs on the operator's machine with its own key, so the two signing keys are now on different
  hosts, which is the point of P1.
