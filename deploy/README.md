# Deployment (prepared, not deployed)

**Status: prepared, not deployed.** Nothing here has been built, started or deployed. The Warden and the console need a
container host with a persistent disk for the Warden and an account the project owner has approved, and neither has been
confirmed (see the decision in [DECISION-JOURNAL](../docs/logs/DECISION-JOURNAL.md) D-085). Until then the deployment row in
the test log is UNVERIFIED.

## What runs where

| Part | Where | Why |
|---|---|---|
| Warden | A container host with a persistent disk (the Warden's state is local files with a lock and fsync; a serverless host cannot hold them) | It holds the Warden's keys and co-signs payments. It is independent of the console. |
| Console | Any host that serves a Node process over HTTPS, separate from the Warden | It only reads the Warden and the agent's log. If it is down, the Warden still answers its own pause route. |
| Agent | Not a server. It runs as a process that writes its transition log. | The agent has no health endpoint; each run writes a status file (a proposal). |

## Secrets

Secrets are mounted or set by the host, never copied into an image and never sent through chat or a repository.

- Warden: the keys file (`warden-keys.json`) and the configuration file are mounted into `/data`, which is the Warden's
  `SIGNOFF_LOCAL_DIR`. The image's `.dockerignore` excludes them.
- Console: the operator file (`operators.json`) and each operator's Warden secret file are mounted, and their paths are
  set with `SIGNOFF_CONSOLE_OPERATORS`, `SIGNOFF_WARDEN_READER_SECRET_FILE`. The console refuses to keep its operator file
  inside the repository.
- Console: `SIGNOFF_WARDEN_URL` names the Warden. `SIGNOFF_TOKEN_ISSUER` and `SIGNOFF_DEMO_RAND_PER_UNIT` are set for receipts
  (see [the console README](../apps/console/README.md)).

## Health

- Warden: `GET /v1/health` answers the pause state, the policy version, the Warden's version and `ready`. It answers without
  authentication and holds nothing secret. `ready` means the service opened its log and journal; it does not check the
  ledger.
- Console: `GET /api/health` answers the status, the version and the mode.
- Synthetic Testnet check: `npm run testnet:synthetic`. It is read-only. It reads the validated ledger index, the spending
  account's balance and the Warden's health. It submits no payment and prints no address. A check that is not set up is
  reported as UNVERIFIED, and only a failed check exits with 1.

## Build (not run)

```bash
docker build -f deploy/warden/Dockerfile -t signoff-warden .
docker build -f deploy/console/Dockerfile -t signoff-console .
```

The images are not built in this work. The Dockerfiles are written to be checked the first time someone builds them.

## Not yet verified

- The images have not been built or started. The health checks in the Dockerfiles have not run.
- The console has not been run with the Warden stopped, to show the console's independence in practice (UNVERIFIED).
- The synthetic check has not been run against a live Testnet with the spending account set (see the test log).
