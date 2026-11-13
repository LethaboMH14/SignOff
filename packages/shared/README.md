# packages/shared (`@signoff/shared`)

Code every SignOff service shares. Two entry points:

- **`@signoff/shared`** (`src/index.ts`): platform-neutral, no Node built-ins, so the console's browser code can import it. Money in minor units, the evidence register, Zod schemas, and the PO and goods-receipt match rules.
- **`@signoff/shared/node`** (`src/node.ts`): Node-only helpers, such as loading a local `.env` file.

| Folder | What it holds |
|---|---|
| `src/money/` | Amounts as integer minor units; no floating-point money |
| `src/schemas/` | Zod contracts for invoices, proposals and records |
| `src/security/` | base58 and XRPL seed checks, secret patterns used by the secret scan |
| `src/logging/` | Structured logging with redaction of secrets and personal data |
| `src/fx/` · `src/calendar/` | FX quote handling and the business-day calendar ([FX-AND-CALENDAR.md](../../docs/FX-AND-CALENDAR.md)) |
| `src/obligation-key.ts` | The stable payable identity that never changes with amount, document or retry (rule R-10) |
| `src/match-rules.ts` · `src/evidence-register.ts` | Matching rules and the register of buyer evidence |

Tests: `npx vitest run packages/shared`.
