# Security model

Status: **draft.** Covers the STRIDE view per pipeline step, the OWASP mapping, and the controls built in Lane H. Each row says what is verified and what is not. Not certified against any standard.

## 1. Pipeline steps

Intake (file arrives) → extraction (model) → match and fraud screen (agent) → Warden checks (sanctions, sender, limits, ledger) → two-signature payment → console (operator).

## 2. STRIDE per step

| Step | Spoofing | Tampering | Repudiation | Info disclosure | Denial of service | Elevation |
|---|---|---|---|---|---|---|
| Intake | Sender domain check (lookalike holds) | MIME and size checks (Lane B) | Log of each file's hash | Logs redacted (tested) | Size and page limits (Lane B) | Parser in a child process |
| Extraction | n/a | Prompt-injection screen (Lane B/A), red team (below) | Prompt hash logged | No secrets in prompts | Model budget (Lane G) | Model proposes only |
| Match / fraud | Supplier name screen, sanctions | Limits in Warden | Decision record | n/a | n/a | Agent cannot sign |
| Warden | Operator routes refuse agent identities | Unsigned terms until final check | Event log | Keys not in logs | Watchdog pause | Separate signer |
| Payment | Multi-signature | Final pre-signing read | Ledger hash | Testnet only | Account busy hold | Two signatures |
| Console | Session and token checks (Lane E) | CSRF and rate limits (ASVS, see §4) | Audit log | Dev fields gated (see §5) | Rate limits | Operator only |

## 3. OWASP mapping

- **OWASP LLM Top 10:** prompt injection (LLM01) is screened in intake and tested with the red team; sensitive disclosure (LLM06) is covered by log redaction and "no keys in prompts"; excessive agency (LLM08) is covered by the rule that the agent cannot sign.
- **OWASP API Top 10:** broken object authorisation and broken authentication are the console's main exposure; they are in the ASVS checklist below and are **not yet verified** for every route.

## 4. Controls built in Lane H

| Control | Evidence | Status |
|---|---|---|
| Sanctions screening (OFAC SDN, fail closed) | `apps/warden/test/sanctions.test.ts` | Built, tested with a real-row fixture; live cache refreshed 2026-11-12 |
| Sender domain exact match and DNS auth | `apps/warden/test/sender.test.ts` | Built, tested; live check via DoH only |
| Secret scan | `npm run secrets:scan`, in `npm run check` and CI | Existing; runs in CI through `npm run check` |
| Dependency audit | `npm audit --audit-level=high` in CI audit job (`.github/workflows/ci.yml`) | Existing (PR #80) |
| Log redaction | `packages/shared/test/logging/redact.test.ts` | Existing |

## 5. ASVS Level 1 for the console (checklist)

| Item | Result | Evidence |
|---|---|---|
| Session tokens are random and not in URLs | Not verified | — |
| CSRF protection on state-changing routes | Not verified | — |
| Rate limits and lockout on login | Not verified | — |
| Dev-only fields hidden unless a flag is set | **Not verified; not built** | — |

This table is incomplete. The console is Lane E's; Lane H has not run the console checks.

## 6. Not done

- Red-team run (promptfoo): not started.
- Dev-field gate and its test: not built.
- Live sanctions service: a free source with clear terms is still to be confirmed (OpenSanctions default data is CC BY-NC 4.0, so it is not used).
