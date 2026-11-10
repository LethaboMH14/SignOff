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
