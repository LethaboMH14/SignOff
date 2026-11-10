# Decision journal

Small and medium decisions, newest at the bottom, so the reasoning is never lost. A decision that changes direction, architecture or security needs a full record in [decisions/](../decisions/) using [the template](../decisions/TEMPLATE.md); link it here.

**When to write which**

| Decision | Where |
|---|---|
| Changes product direction, architecture, trust boundaries, or a rule in RULES.md | ADR in `decisions/` |
| A library, naming, threshold, default value, a scope cut, a workaround | This journal |
| A one-off choice inside a pull request with no lasting effect | Pull request description |

## Entry format

| ID | Date | Decision | Why | Alternatives considered | Decided by | Link |
|---|---|---|---|---|---|---|

## Entries

| ID | Date | Decision | Why | Alternatives considered | Decided by | Link |
|---|---|---|---|---|---|---|
| D-001 | 2026-11-09 | Enter the Agentic Finance (Ripple) track | Fits the build; prize path to Ripple's accelerator | Other three tracks | Team | [CLAUDE-PLAN.md](../CLAUDE-PLAN.md) |
| D-002 | 2026-11-10 | South African supplier as first-customer hypothesis; buyer controls payments | Business score and local relevance | Lusaka buyer only | Team | [ADR 0001](../decisions/0001-supplier-anchored-reframe.md) |
| D-003 | 2026-11-10 | Plain multi-signing as the core; delegation out of the critical path | Delegation status unverified; schedule | Delegation as core | Team | [ADR 0002](../decisions/0002-plain-multisign-core.md) |
| D-004 | 2026-11-10 | No quantum features | No product value; credibility risk | Post-quantum signatures as a feature | Team | [ADR 0003](../decisions/0003-no-quantum-in-mvp.md) |
| D-005 | 2026-11-10 | Trust line limit is an exposure layer, not a loss cap | Official docs: own actions can exceed it | Market it as a cap (rejected as false) | Review | [ADR 0004](../decisions/0004-workshop-adjustments.md) |
| D-006 | 2026-11-10 | Remove the recovery signer; Agent 1 + Warden 1, quorum 2 | Warden + recovery could pay without the agent | Weights 1/2/1 quorum 3 | Review | [TRUST.md](../TRUST.md#signer-configuration-and-every-signing-path) |
| D-007 | 2026-11-10 | Stable obligation identity independent of amount | Edited amounts would create new payables | Supplier + invoice number + amount | Review | [ENGINEERING.md](../ENGINEERING.md#payment-state-machine) |
| D-008 | 2026-11-10 | Fixed workflow; model only extracts and reviews | Simplest reliable design for a defined task | Free-roaming agent | Team | [AGENT-RELIABILITY.md](../AGENT-RELIABILITY.md) |
| D-009 | 2026-11-10 | Arduino Warden Switch as stretch; one-way STOP; no keys on device | Visible human veto; safe if unplugged | Device as hardware wallet (rejected) | Team | [ADR 0005](../decisions/0005-arduino-operator-hardware.md) |
| D-010 | 2026-11-10 | Rules, PRD, issues and logs adopted before code | Keep research and evidence disciplined | Start coding from the brief | Team | [RULES.md](../RULES.md) |
| D-011 | 2026-11-10 | TypeScript 6.0.3, not 7.0.2 | typescript-eslint 8.72.1 supports TypeScript below 6.1.0; TypeScript 7 is outside that range | TypeScript 7.0.2 (rejected: unsupported by the lint toolchain) | Sibusiso with Claude | commit b07b352 |
| D-012 | 2026-11-10 | 7-day cooldown on new dependency versions, exact pins, and a logged exception for security fixes | New releases are the likeliest window for a supply-chain attack; waiting a week lets the ecosystem catch one | Adopt the latest immediately (rejected); 14 days (rejected: slows Gate 0 with little extra protection) | Sibusiso with Claude | [SECURITY-LOG.md](SECURITY-LOG.md), T-13 |
| D-013 | 2026-11-10 | Pinned versions and publish dates: vitest 5.1.0 (2026-11-02), @vitest/coverage-v8 5.1.0, eslint 10.14.0 (2026-10-30), @eslint/js 10.0.1 (2026-02-06), typescript-eslint 8.72.1 (2026-10-26), eslint-plugin-security 4.2.1 (2026-10-30), prettier 3.9.10 (2026-10-10), globals 17.14.0 (2026-11-01), zod 4.6.7 (2026-10-12), @types/node 24.19.2 (2026-10-09), typescript 6.0.3 (2026-04-16) | Each passes the cooldown and the peer ranges of the others | Newer majors (rejected: inside the cooldown or unsupported together) | Sibusiso with Claude | commit b07b352 |
| D-014 | 2026-11-10 | minimatch overridden to 11.0.5, published 2026-11-05 and adopted as a security fix under the cooldown exception | Clears GHSA-g3hv-75wg-m249 (ReDoS, affected range 7.0.0 to below 11.0.1). It is reached only through the lint toolchain, which reads our own glob patterns | Accept the moderate risk (rejected: a fix exists and every check passes); downgrade ESLint to 9 (rejected) | Sibusiso with Claude | commit b07b352; re-check when ESLint or typescript-eslint update their dependency |
| D-015 | 2026-11-10 | Workspaces listed explicitly, not by glob; apps and packages/xrpl are placeholders until their gate | A glob also matches folders without a package.json; explicit listing keeps the state of the build visible | Glob patterns (rejected); empty packages (rejected) | Sibusiso with Claude | commit b07b352 |
| D-016 | 2026-11-10 | Prettier checks code and configuration only; documents are excluded | People review documents, and formatting would rewrite every table | Format documents too (rejected) | Sibusiso with Claude | commit b07b352 |
| D-017 | 2026-11-10 | Coverage thresholds of 90% for lines, functions and statements and 85% for branches; an empty test run fails | Forces tests for the security-critical code that later gates add | Advisory coverage only (rejected) | Sibusiso with Claude | commit b07b352 |
