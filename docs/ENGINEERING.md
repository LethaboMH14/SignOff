# Engineering plan

How this repository will be built, reviewed, tested and released. **This is a plan. None of it exists yet**, and it is sized for the four days before the deadline. Items marked *stretch* are done only if the core flow works first.

## Repository layout (planned)

```
apps/
  console/     Operator console (React, Vite)
  agent/       Invoice intake, extraction, matching, payment proposals
  warden/      Rule checks, second signature, ledger submission (deployed separately)
packages/
  shared/      Schemas, types, rule definitions, test fixtures
  xrpl/        Ledger helpers: account setup, signing, reliable submission
docs/          Problem, solution, business, decisions, runbooks
scripts/       Testnet provisioning, judge check, attack suite
.github/       Pull request template, workflows
```

Warden lives in the same repository but deploys as its own service with its own identity and key. The agent's deployment must have no access to Warden's key.

## How work is reviewed

- `main` is protected. Changes arrive by pull request.
- Each pull request is small, has one purpose, and is reviewed by the other team member.
- Merge commits, not squash, so judges can see the build history.
- Every pull request states what is real, what is simulated, and what evidence supports any claim.
- Pre-existing code is disclosed. Ideas from earlier projects are reused; code is written fresh.

## Tests

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | Each Warden rule passes and fails correctly; schemas reject bad input |
| Integration | Vitest against XRPL Testnet | A two-signature payment validates; one signature alone is rejected; a paused system refuses |
| End to end | Playwright | The three demo flows on desktop and phone: valid payment, changed-payee hold, lowered-limit hold |
| Attack suite | Scripted Testnet runs | Each attack in the table below has an observed, recorded outcome |
| Offline mode | Fixture data, labelled | Tests run without model calls or ledger access, so checks are fast and free |

### Attack suite

Each case records the expected result and the actual result code or transaction hash.

| Attack | Expected |
|---|---|
| Changed payee on the invoice | Hold |
| Hidden instruction inside the PDF | Hold |
| Missing goods-received record | Hold |
| Duplicate invoice | Hold |
| Two requests at once to beat the daily limit | One proceeds, one held |
| Amount above the limit | Hold |
| Agent key used alone | Ledger rejects |
| Warden key used alone | Ledger rejects |
| Ledger timeout during submission | No double payment; reconciled before retry |
| Limit lowered by the operator | Next invoice held |
| Legitimate invoice | Paid, to catch false blocks |

## Security checks

- Secret scanning and push protection on the repository.
- Dependency audit on every pull request; Dependabot enabled.
- Keys only in a secret manager, never in the repository, logs, model context or ledger memos.
- Invoice content treated as untrusted input everywhere.
- Operator actions authenticated; Warden's endpoints reject cross-site and unauthenticated calls.
- A written threat model in `docs/` before the first payment code is merged.
- No invoice data or names on the public ledger; hashes only.

## Before release

Run on every pull request and before each deployment:

1. Type check and lint.
2. Unit and offline integration tests.
3. Build of all three apps.
4. Secret scan and dependency audit.
5. Testnet integration tests (on `main` and before the demo, since they depend on an external network).

## After release

1. Health endpoint on each service reports version and readiness.
2. One scripted live payment on Testnet as a smoke test.
3. Confirm the console shows the validated result and the explorer link opens.
4. Record the previous deployment as the rollback candidate.
5. Re-record the backup demo video if the flow changed.

## Judge check

One command that a judge can run to verify the repository's claims: it provisions fresh Testnet accounts, runs the valid payment and the attack suite, and prints each result with its ledger reference. The README will state how long it takes and what it does not cover.

## Tools

| Purpose | Tool | Note |
|---|---|---|
| Ledger | xrpl.js, Testnet and RLUSD faucets, Testnet explorer | Explorer links are the proof judges can click |
| Agent interface | MCP tool for `propose_payment` | Matches the track's wording |
| Model | Claude Haiku through the Anthropic Messages API, structured outputs | At most three model calls per invoice |
| Orchestration | LangGraph.js | As in the build brief |
| Hosting | To be decided: the brief proposes Cloud Run and Firebase; Vercel and Supabase are faster for this team | Warden must be a separate deployment either way |
| Tests | Vitest, Playwright | |
| Checks | GitHub Actions | |
| Design | Figma for the four mockups | Before any console code |

## Order of work

1. Ninety-minute Testnet check: two-signature RLUSD payment validates; one signature fails. Record the hashes.
2. Warden rules with unit tests.
3. Agent loop on fixture invoices.
4. Console: payment desk, hold view, limits, receipt.
5. Attack suite and judge check.
6. Deployment, video, submission a day early.
7. *Stretch:* permission delegation, supplier record signed with an additional quantum-safe signature, wallet-based operator approval.
