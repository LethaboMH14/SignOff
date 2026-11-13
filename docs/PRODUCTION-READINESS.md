# Production readiness

Written 13 November 2026. SignOff moves Testnet RLUSD, which has no real value. This page states what is needed before it moves real money, what is already in place, and who can do each item. It is not legal advice; [COMPLIANCE.md](COMPLIANCE.md) has the obligations.

**Today's honest position: a working, tested Testnet system with a hosted simulated console. It is not production-ready for real money, and it cannot become so before the deadline.** The blocking items are legal, partner and custody work, not code.

## Already in place (with evidence)

| Area | What exists | Evidence |
|---|---|---|
| Payment safety | Two signers required by the ledger; each key alone refused | [TEST-LOG](logs/TEST-LOG.md) T-052, T-054 |
| End-to-end flow | Model reads the invoice, the Warden checks and co-signs, RLUSD paid and reconciled | T-251, T-257, T-260 |
| Rules outside the agent | Payee, order and receipt match, duplicates, limits, pause, supplier credential | T-071, T-072, T-124, T-252, T-257 |
| Fail-safe evidence | A later unreadable evidence file keeps the last valid version, so the invoice is held, never paid on a guess | T-261 |
| Prompt-injection screen | Instruction-like text and payee-change claims are quarantined before a model reads them | [ATTACK-SUITE.md](ATTACK-SUITE.md), the simulated replay in T-262 |
| Console security | Signed sessions, CSRF token, origin check, role split (viewer cannot act), recent-password step-up for changes | Console tests; T-258, T-261 |
| Secrets hygiene | Staged secret scan on every commit; keys and passwords live outside the repository | `npm run check`; every commit's scan line |
| Tests | 1,582 automated tests in the full check on 13 November | `npm run check`, 137 files |
| Hosting | Simulated console on Vercel with a health route | T-259, T-262 |

## Can be done in code, after the deadline

| # | Item | Why | Effort |
|---|---|---|---|
| P1 | Host the Warden on its own server, separate from the agent and the console, with TLS | One machine holding both signing roles defeats the two-signature design | 1 to 2 days |
| P2 | Move the Warden and agent keys into a cloud key service or HSM (for example AWS KMS or Azure Key Vault) instead of local files | A stolen laptop must not be a stolen key | 2 to 3 days |
| P3 | Durable storage for the agent log and Warden decisions (a managed database with backups), replacing local files | Audit trail must survive a disk failure | 2 days |
| P4 | Alerts: Warden down, payment held, ledger unreadable, limit near, unusual payee change attempt | An operator must know within minutes | 1 day |
| P5 | A real identity provider with MFA for the hosted console. Sign-in already has a guard against repeated failures (`LoginGuard`); per-route rate limits on the API are not built | Public exposure | 1 to 2 days |
| P6 | The 10 RLUSD run and a live negative run (uncredentialed supplier held) on Testnet | Open items in the README | Hours |
| P7 | Live model error rate on the labelled set brought down, then measured again | The pipeline model call failed on 20 to 22 of 30 cases in the last measurement; a hold is safe but slow | Days |
| P8 | Accounting link (Xero or Sage) for purchase orders and goods receipts, instead of an evidence file | Customers will not maintain a JSON file | 1 to 2 weeks |
| P9 | Bank account verification (AVS-R) through a provider, replacing the simulated allow-list | Supplier enrolment must check the real account | Depends on the provider |

## Needs people outside the team

| # | Item | Who | Status |
|---|---|---|---|
| X1 | Legal opinion in South Africa and the buyer's country, including whether SignOff itself is regulated | A fintech lawyer | Not started |
| X2 | Signed agreement with a licensed RLUSD-to-rand payout partner (due diligence, travel rule, sanctions) | Yellow Card, VALR or Chipper Cash | Not contacted; draft message in [CUSTOMER-DISCOVERY.md](CUSTOMER-DISCOVERY.md) |
| X3 | Sanctions and screening provider | A screening vendor | Not started |
| X4 | Independent security review of the Warden, and a POPIA impact assessment | A security firm; an information officer | Not started |
| X5 | A first pilot customer on Testnet, then a capped live pilot | A supplier from the interviews | Not started |
| X6 | South Africa's cross-border crypto rules settled (a revised second draft is pending) | Treasury and the Reserve Bank | Outside our control |

## Order of work after the event

1. Interviews and one pilot customer on Testnet (X5), because they decide whether to build the rest.
2. P1, P2 and P4 together: separate hosts, keys in a key service, alerts.
3. X1 and X2 in parallel, since they take weeks.
4. P3, P5, P8 and P9 for the pilot customer's real workflow.
5. X4 before the first real rand moves, capped by the Warden's per-payment and daily limits.
