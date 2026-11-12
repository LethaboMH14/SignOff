# Deploying SignOff (Lane I): status and the owner's steps

**Status: NOT DEPLOYED.** No public URL exists. The host choice needs the owner (see [ADR 0009](decisions/0009-free-host-for-the-demo.md)). Nothing has been built as a container image; no Docker build ran locally.

## What is ready in the repository

- `deploy/warden/Dockerfile` and `deploy/console/Dockerfile`: one image per service. Both start through `deploy/entrypoint.mjs`.
- `deploy/entrypoint.mjs`: writes each service's secrets from environment variables into `SIGNOFF_LOCAL_DIR/<service>` (mode 0600), then starts the service. It refuses to start when a variable is missing and prints only the variable's name.
- Health: Warden `GET /v1/health` (returns `ready`), console `GET /api/health`.
- Console bind: in a container, `SIGNOFF_CONSOLE_HOST=0.0.0.0` works only with `SIGNOFF_CONSOLE_ALLOW_ALL_INTERFACES=1`, set in the console Dockerfile. `SIGNOFF_CONSOLE_PUBLIC_ORIGIN` names the public HTTPS origin for the console's CSRF check.

## Secrets per service (set in the host's secret store, never in an image or in the repo)

| Service | Variables | Who holds them |
|---|---|---|
| Warden | `SIGNOFF_WARDEN_CONFIG_B64` (base64 of `warden-config.json`), `SIGNOFF_WARDEN_KEYS_B64` (base64 of `warden-keys.json`, holds the Testnet Warden seed) | Warden only |
| Console | `SIGNOFF_CONSOLE_OPERATORS_B64` (base64 of `operators.json`), `SIGNOFF_WARDEN_READER_SECRET_B64` (the reader's base64 secret) | Console only |
| Agent | model keys (for example `META_API_KEY`) | Agent only; the agent is not a container in this plan |

Make the base64 values locally without printing them, for example `base64 -w0 <file> > <file>.b64`, then paste the file's contents into the host's secret field. Do not paste values into chat.

## Persistence

The Warden's state directory (`SIGNOFF_LOCAL_DIR`, default `/data` in the image) must be a persistent volume or bucket. A free Hugging Face Space and a free Render service both lose it on restart. See ADR 0009.

## The owner's steps (placeholders; nothing here has been run)

1. Choose a host from ADR 0009 and sign up yourself. Do not share your login with anyone, and do not paste it into chat.
2. Create one service per container, with a persistent volume mounted at `/data`.
3. Set the variables above. Use placeholders only in your notes, for example `<WARDEN_CONFIG_B64>`.
4. Set `SIGNOFF_CONSOLE_PUBLIC_ORIGIN` to the console's HTTPS URL, for example `https://<your-console-host>`.
5. Build from the repository root on the host (or in CI), not on a laptop with little disk space:
   `docker build -f deploy/warden/Dockerfile -t signoff-warden .` and `docker build -f deploy/console/Dockerfile -t signoff-console .`
6. Restart each service once and check `GET /v1/health` (Warden) and `GET /api/health` (console).

## Smoke test (after a public URL exists)

- The console's sign-in page loads over HTTPS.
- `GET /api/health` and the Warden's `GET /v1/health` return success, and the Warden shows `ready: true`.
- One held invoice is visible. This needs the agent's transition log on the console's volume; that wiring is not built yet, so this step is NOT run.

## Not verified

- Images have not been built or started. The health checks have not run in a container.
- Container restart and state survival have not been tested on a real host. The Warden's journal and limits survive an in-process restart (existing tests, see ADR 0009).
- The console has not been run with the Warden stopped.
