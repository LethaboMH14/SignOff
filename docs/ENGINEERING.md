# Engineering plan

How this repository is built, reviewed, tested and released. **Gate 0 and incremental Gate A are merged and CI-tested (owner settings remain open). Gate B (Warden) and Gate C (invoice agent) are implemented and offline-tested on feature branches but not merged. Gate C's labelled evaluation is SIMULATED. One RLUSD payment (1 RLUSD) is validated on Testnet (T-059); the 10 RLUSD run is open. The model-to-Warden Testnet run remains UNVERIFIED.** It is sized for the four days before the deadline. Items marked *stretch* are done only if the core flow works first.

## Repository layout

As built on the merged foundation and feature branches; only Gate 0 and incremental Gate A are merged.

```
packages/shared/  money rules, Zod contracts, security (base58, XRPL seeds, secret patterns),
                  logging and redaction, obligation key; entries "." (neutral) and "./node"
packages/xrpl/    Gate A Testnet ledger implementation, signing, reliable send, failover and rebuild (under review)
apps/warden/      Gate B feature branch: rules, Warden final signature, pause (not merged)
apps/agent/       Gate C feature branch: invoice extraction, matching, proposals (not merged)
packages/warden-api/ Gate C feature branch: signed requests, contracts, caller client
apps/console/     planned, Gate D: operator console
docs/             problem, solution, business, decisions, logs, runbooks
scripts/          secret scanner, hook installer, configuration guard tests; Gate A Testnet commands
.githooks/        pre-commit secret check
.github/          CI workflow, Dependabot, pull request template
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
| Guard tests | Vitest | Strictness flags, the Node 24 pin, exact installs, the workspace list, the secret-file ignore rules and the platform-neutral entry point stay as specified |
| Security unit tests | Vitest | The seed checksum, the secret patterns, the scanner and the redaction behave correctly, including the cases that must not match |

**Gate 0 tooling as built:** Vitest 5.1.0 with v8 coverage (90% of statements, functions and lines; 85% of branches). TypeScript 6.0.3 with every strict flag. ESLint 10 with typescript-eslint strict and stylistic type-checked rules and eslint-plugin-security. Prettier for code. `npm run check` runs every check, including the secret scan of tracked files. At the close of Gate 0: 211 tests in 17 files.

**Gate A evidence status:** Testnet transactions using a *test-issued token* are recorded in [TEST-LOG T-053 to T-058](logs/TEST-LOG.md). Single-key rejections are recorded in T-054. One RLUSD Testnet payment is validated (T-059: 1 RLUSD, ledger 22255596, hash 3CCC034B2A36A8567625875B4C32B0AC5D3B1875696706ABA27858B1586265F9). The 10 RLUSD run is open (T-061 refused before sending while the account held 0 RLUSD). The TST results do not count as RLUSD proof. Incremental Gate A PR #19 is merged with post-merge CI passing; issue #22 stays OPEN for the 10 RLUSD run.

**Gate C evidence boundary:** The labelled 30-case evaluation uses rule-based stand-ins and is **SIMULATED**. A live model evaluation (T-088) and live Agent → Warden → Testnet run (T-087) remain NOT RUN. Simulated 30/30 results are not measured model accuracy. The Warden signs only after its final policy and ledger checks.

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

- GitHub secret scanning and push protection, plus a local pre-commit check using tested XRPL seed and private-key patterns (not a naive "starts with s" rule), itself tested against known test values and false positives. The Ripple workshop singled out AI tools leaking seeds into public repositories.
- Each service reads only its own secret, through its own identity in the secret manager.
- Logs redact seeds, keys, bank details and personal data; a test checks this.
- A written, rehearsed key-rotation procedure for every key in [TRUST.md](TRUST.md).
- No test seeds in public demo logs or recordings.
- Dependency audit on every pull request; Dependabot enabled.
- Keys only in a secret manager, never in the repository, logs, model context or ledger memos.
- Invoice content treated as untrusted input everywhere.
- Operator actions authenticated; Warden's endpoints reject cross-site and unauthenticated calls.
- Trust boundaries are in [TRUST.md](TRUST.md). A written threat model extends it before the first payment code is merged.
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
| Ledger | xrpl.js, Testnet faucet (100 test XRP), RLUSD faucet at tryrlusd.com, Testnet explorer | Explorer links are the proof judges can click. Budget 1 XRP per account plus 0.2 XRP per trust line, signer list and credential |
| Development help | XRPL MCP server in Claude Code, XRPL AI starter kit | Named in the Ripple workshop |
| Agent key (option) | Privy agent wallet | Recommended in the workshop; use only if it can sign for an XRPL multi-signed transaction |
| Agent interface | MCP tool for `propose_payment` | Matches the track's wording |
| Model | Claude Haiku through the Anthropic Messages API, structured outputs | At most three model calls per invoice |
| Orchestration | LangGraph.js | As in the build brief |
| Hosting | To be decided: the brief proposes Cloud Run and Firebase; Vercel and Supabase are faster for this team | Warden must be a separate deployment either way |
| Tests | Vitest, Playwright | |
| Checks | GitHub Actions | |
| Design | Figma for the four mockups | Before any console code |

## Payment state machine

Every invoice moves through named states, and every transition is recorded with a reason, the actor, the policy version and the evidence used:

`RECEIVED → EXTRACTED → NEEDS_EVIDENCE / REVIEW / HELD → AUTHORIZED → SUBMITTED → VALIDATED → RECONCILED`, or `FAILED`.

- **A stable obligation identity, separate from the amount and file hash.** Create a buyer-owned immutable obligation ID when a payable is first approved, scoped by the buyer/business unit, enrolled supplier and normalized supplier invoice reference, with PO/contract linkage where present. Store every original and revised document **fingerprint as an evidence version / duplicate-detection alias**, not as a component of the stable obligation ID. An edited PDF changes its hash, not the payable's identity. If a supplier changes the invoice reference, require explicit review and an alias mapping rather than silently creating a new obligation.
- **Amounts tracked against it:** approved amount, amount reserved, amount settled, amount remaining. Partial payments, credit notes and edits update these figures; they never create a new obligation.
- **Each payment attempt** has its own attempt identity linked to the obligation, so retries are traceable and at most one attempt per obligation is unresolved at a time.
- **Near-duplicates are checked too:** repeated document hashes, similar supplier invoice references, identical orders and suspicious amount changes are held for review across approved and settled obligations, even when invoice identifiers differ. Outstanding balance, partial settlements, credit notes and amendments remain linked to the original obligation.
- **Atomic reservation:** Warden reserves the amount against the daily limit before signing and releases it only on reconciliation or expiry.
- **Bound approval:** Warden's decision covers the exact final transaction fields and the policy version. It signs only those bytes.
- **Persist before submit:** sequence, transaction hash and expiry ledger are stored before submission.
- **Reconcile before retry or "paid":** only a validated transaction with the expected delivered amount moves an invoice to `VALIDATED`. A timeout leads to reconciliation, never a blind resubmission.
- **Fail closed:** if Warden cannot read the ledger, its records or its policy, it refuses.
- **Independent pause route:** an authenticated pause endpoint on Warden that does not depend on the console, tested by pausing with the console stopped.

## Evidence for each test

Every test in the attack suite and the Testnet checks records: the scenario, the expected result, the actual result code or hash, the policy version, the commit, and the date. A test without a recorded result does not count as passed.

## Service levels and compliance

Targets, the fastest reliability measures and dependency failure behaviour are in [SERVICE-LEVELS.md](SERVICE-LEVELS.md). Obligations and how the design meets them are in [COMPLIANCE.md](COMPLIANCE.md). Hard objectives (no rule-breaking payment, no duplicate, no false "paid", full traceability) block a release on any failure.

## Delivery gates

From the [CFO and fraud research](CFO-AGENTIC-FRAUD-SECURITY-RESEARCH-2026-11-10.md), section 10. Each gate must pass before the next is claimed.

| Gate | Must show |
|---|---|
| 0. Foundation | Strict TypeScript monorepo with one install command; CI on every pull request; secret protection; shared contracts; log redaction. Built and tested (T-001 to T-049). Closes when its pull requests merge (D-038), with the repository settings in S-005 in place |
| A. Ledger proof | RLUSD trust lines; signer list as in [TRUST.md](TRUST.md); a validated two-signature payment; each key alone rejected; Agent + Warden the only accepted path; a signer change refused without two approvals; rebuild from reserve tested; hashes recorded |
| B. Warden controls | Authenticated proposals, verified payee, three-way match, duplicate lock, limits, pause; no failed hard control ever leads to a signature |
| C. Reliability and evidence | Real PDF extraction with source spans, labelled test set, single-prompt baseline, decision log |
| D. Operations and console | Payment desk, changed-payee hold, lowered-limit hold, validated receipt; never "paid" before validation; safe behaviour on timeout |
| E. Credible pitch | A consenting finance-lead interview; the README status table complete; no savings or partner claims |

After the gates, and only if verified on Testnet: credentials, batch payments, token escrow (RLUSD escrow not available (issuer allowTrustLineLocking false, to be re-read on ledger)), a Privy agent wallet, and permission delegation. **Optional judge demonstration after Gates A and B:** the Arduino **Warden Switch** (one-way physical pause, confirmed guard state, optional RFID) under [ADR 0005](decisions/0005-arduino-operator-hardware.md) and its [judge runbook](ARDUINO-JUDGE-DEMO-RUNBOOK.md). The server-side watchdog and no-hardware-resume requirement must be implemented and tested before either is demonstrated as a security feature; omit hardware if it endangers the primary working demo.

## Keeping claims honest

Every item in the README's "Status of every claim" table moves through four states, and only moves with evidence:

| State | Evidence required |
|---|---|
| Planned | Described in a document |
| Live on Testnet | A transaction hash or test run linked in the README, recorded as in "Evidence for each test" |
| Simulated | Labelled "simulated" in the console, the README and the video |
| Validated with customers | A recorded, consenting conversation or written statement |

A pull request that changes a state updates that table in the same change.
