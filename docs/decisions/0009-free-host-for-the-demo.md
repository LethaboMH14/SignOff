# 0009: Free host for the demo: no verified option yet; the Warden needs a persistent disk

- **Status:** Accepted — 2026-11-12 (host choice still open; owner decision needed, see Consequences)
- **Affects:** `deploy/`, `docs/DEPLOY.md`, the Warden's state directory, the console's bind address
- **Rules touched:** none
- **Journal:** D-131 in [DECISION-JOURNAL.md](../logs/DECISION-JOURNAL.md)

## Context

The approved plan (section 3) puts the three services on Azure. The owner's only subscription is `Disabled`, so the owner asked for a free host. The Warden keeps its journal, limits and event log as files (`warden-config.json`, `payments-journal.jsonl`, `events.jsonl`, under `SIGNOFF_LOCAL_DIR`). A restart that loses those files would reset the limits and could re-sign a payment, so the Warden needs a disk that survives restarts.

Terms, read from each vendor's own page on 2026-11-12 (quotes from the pages):

| Host | Free terms (quoted) | Persistent disk on free | Verdict |
|---|---|---|---|
| Hugging Face Spaces | CPU Basic: "2 vCPU | 16 GB" and "50GB of (not persistent) disk space". "Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts". Persistent storage is "[Storage Buckets](./storage-buckets)"; no free price for Spaces was found. | No. Disk "will be lost if your Space restarts or is stopped." | Blocked: the owner's account is not PRO (`is_pro: false`), and the HF connector token has no Spaces write scope. |
| Render | "Free web services can't use persistent disks." Spins down: "a Free web service that goes 15 minutes without receiving any inbound traffic." | No. | Fails the persistence requirement. |
| Railway | Free: "$1 of free credit per month". Trial: "one-time grant of $5", 30 days. Volume storage: 0.5 GB on Trial and Free; "Volume data is deleted 30 days after expiry". | Yes, but 0.5 GB and expires. | Possible bridge for the 13 Nov deadline window only; card status unverified. |
| Koyeb | No free compute tier on the pricing page; only "Free 5h" serverless Postgres. | Not confirmed for free. | Not usable free. |
| Fly.io | Free allowance removed for new organisations (secondary sources only; official page not read). | Paid. | Not free. |
| Oracle Always Free | Not verified: the vendor page returned HTTP 403 to the reader. | Believed to include block storage; not checked. | Needs the owner's sign-up and card. Not verified. |

## Decision

1. Keep one container definition per service (`deploy/warden/Dockerfile`, `deploy/console/Dockerfile`). Each starts through `deploy/entrypoint.mjs`, which writes only that service's secrets from the host's secret store into `SIGNOFF_LOCAL_DIR/<service>` (mode 0600). It refuses to start when a variable is missing, and it names the variable, never the value.
2. Do not deploy the Warden to a host without a persistent disk. The Warden is the only service that holds keys and signs payments.
3. Do not claim a deployment until a public URL exists and the smoke test in [docs/DEPLOY.md](../DEPLOY.md) passes.
4. Recommended host, for the owner to choose: **Oracle Always Free** (a VM with block storage, needs the owner's sign-up and card; terms to be verified in a browser first). Second: **Hugging Face PRO plus a paid storage bucket** for the Warden (owner pays; price per GB to be read from the HF page). Third: **Railway trial** as a short bridge only, because volumes expire.

## Alternatives considered

| Option | Why not |
|---|---|
| Deploy all three on Render free | No persistent disk; the Warden would lose its limits on each spin-down. |
| Deploy on HF free Spaces with the journal copied to a private dataset | Not built. It would need a sync that is part of the Warden's write path, which is a code change and a new failure mode; not started without the owner's choice. |
| Keep Azure | Subscription disabled; owner asked for free hosting. |

## Consequences

- No public deployment exists yet. The deployment row in the test log stays UNVERIFIED until the owner chooses and signs up.
- The console needs a non-loopback bind in a container. `SIGNOFF_CONSOLE_ALLOW_ALL_INTERFACES=1` allows `0.0.0.0` only when set; a local start still refuses it.
- The console accepts a public origin for its CSRF check through `SIGNOFF_CONSOLE_PUBLIC_ORIGIN`.
- The agent is not a server. Its transition log must be on a volume the console can read; that wiring is not built.
- The Dockerfiles have not been built (no Docker build locally, disk is short; building on the host or in CI remains to do).

## Evidence required

- Restart: `npx vitest run apps/warden/test/limits-approval.test.ts apps/warden/test/service.test.ts` (57 tests pass, including the recovery and restart cases). This is an in-process restart of the service, not a container restart. A container restart test is still to run.
- Live deployment: not done. Logged as UNVERIFIED in the test log.
