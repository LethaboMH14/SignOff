# Release checks: before and after deploying

The checks a release of SignOff must pass, with the result of the run on **13 November 2026** (the submission build).
Every command runs from the repository root. Ledger checks use XRPL Testnet; Testnet RLUSD has no real value.

## Before deploying (pre-production)

| # | Check | Command | Pass when | 13 Nov result |
|---|---|---|---|---|
| 1 | Formatting, lint (0 warnings), types, secret scan, tests with coverage thresholds, build | `npm run check` | Exit 0 | PASS: 143 test files, 1,628 tests; coverage 90.89% statements, 90.15% functions; secret scan 589 files, 0 issues. One flaky OCR test (5 s default limit under load) given the OCR limit |
| 2 | Same, in CI on every push of the pull request | GitHub Actions `CI` | Green | PASS: runs on PR #89 green |
| 3 | Dependency audit, all and production | `npm audit --audit-level=low`; `npm audit --omit=dev` | 0 vulnerabilities | PASS: 0 and 0 |
| 4 | Warden attack suite | `npm run attack` | Every case PASS | PASS: 26 of 26 (ATK-01 to ATK-13, PIN-01 to PIN-05) |
| 5 | Judge check: payment and injection tests, labelled-set re-run against the committed result | `npm run judge:check` | 0 fail | PASS: 3 pass, 0 fail, 3 read (live model runs), 1 unverified (live payments, by design offline). Two defects found and fixed: it compared against a file removed on 12 Nov, and the committed result was stale (5 labels changed under D-101) |
| 6 | Code review of the day's changes | `/code-review` at high effort | Findings fixed or recorded | 11 findings; 7 fixed with tests (mail watcher hang on close, misreported start-up error, overlapping checks, redelivery, key text in a log, partial seeding, bundle order); 4 recorded below |
| 7 | Single-key refusals on the live ledger, RLUSD path | `npm run testnet:rejections-rlusd` | Each key alone refused; nothing moves | PASS: agent alone and Warden alone refused `tefBAD_QUORUM` for a payment and for a signer-list change; recipient unchanged |

## After deploying (post-production)

| # | Check | Command | Pass when | 13 Nov result |
|---|---|---|---|---|
| 8 | Synthetic check against the hosted Warden | `SIGNOFF_SPENDING_ADDRESS=… SIGNOFF_WARDEN_URL=https://warden-production-4f0fcb91.up.railway.app npm run testnet:synthetic` | ok, no payment submitted | PASS: validated ledger read, spending account readable, Warden ready, rules 2026-11-10.1 |
| 9 | Hosted Warden refuses unsigned requests | `curl` POST `/v1/proposals`, GET `/v1/ops/overview`, POST `/v1/control/pause` | 401 | PASS: 401, 401, 401 |
| 10 | Hosted Warden transport | `curl` on `http://` and response headers | http redirects to https; `nosniff`, `no-store` | PASS: 301 to https; headers present. Railway's edge sends no HSTS header (recorded) |
| 11 | A paid invoice through the hosted Warden | `npm run demo -- --email --warden-url …`, then `npm run demo:verify <hash>` | Validated, two signers | PASS: T-268, ledger 22293838 |
| 12 | Live console refuses signed-out reads and cross-site control | `curl` `/api/desk`, `/api/session`, POST `/api/control/pause` | 401 | PASS: 401, 401, 401; CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` on pages |
| 13 | Public simulated console | `curl` `/`, `/api/health`, `/api/desk` | 200, simulated, 401 | PASS: 200, `{"mode":"simulated"}`, 401. **Gap:** the CDN-served pages lacked the CSP and frame headers the Node server sends; fixed in `deploy/console/vercel-output-config.json`, redeploy pending the owner's approval |

## Recorded, not fixed before the deadline

| Item | Risk | Plan |
|---|---|---|
| The mail watcher logs in to Gmail every 5 seconds | Gmail may throttle, so an emailed invoice is picked up late | One connection with ImapFlow's `socketTimeout`, reconnect on close |
| Prepared invoices for the hosted Warden also have local Warden records | Switching back to the local Warden could pay one twice; only the agent's log prevents it | One Warden per spending account; a shared payment journal |
| Evidence files are rewritten without a lock | Two writers at once can drop one invoice's records (held, never paid) | A lock or an append-only evidence log |
| No HSTS header from Railway's edge | A first plain-http visit could be intercepted | The Warden is called by the agent over https only; add HSTS at the app or a custom domain |
| Warden key on a Railway volume | Project members can reach it | Key service or HSM (P2) |
