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

## 7. Hook for Lane E: wiring the sanctions and sender checks into the Warden

Neither check is called by `apps/warden/src/service.ts` yet. That file belongs to Lane E, so Lane H did not edit it. The intended wiring:

1. **Sanctions, once per supplier at enrolment and again before each payment:**
   ```ts
   import { loadSnapshot } from './checks/sanctions-source.js';
   import { screenSupplierName, sanctionsVerdict } from './checks/sanctions.js';
   // snapshot = loadSnapshot(join(directory, 'var/sanctions/ofac-sdn.json')); // null when missing
   const verdict = sanctionsVerdict(screenSupplierName(supplier.legalName, snapshot, new Date()));
   if (verdict) return verdict; // HOLD, never REFUSE
   ```
   The path must come from the Warden's own directory. The cache is refreshed by `npm run sanctions:refresh`.
2. **Sender, at each proposal, after the payee check:**
   ```ts
   import { senderPosture, senderVerdict } from './checks/sender.js';
   const posture = await senderPosture(facts.senderDomain); // resolver defaults to Node dns
   const verdict = senderVerdict({ senderDomain: facts.senderDomain, enrolledDomain: supplier.domain }, posture);
   if (verdict) return verdict;
   ```
   `senderPosture` must not be called with a domain taken from the agent's output without an exact match first. The function itself does not trust it.

Both hooks return a HOLD on any failure, including an unreadable list or a DNS error. The Warden must not treat a null snapshot as a clear result. A test that runs the hook through `WardenService` belongs with Lane E.
