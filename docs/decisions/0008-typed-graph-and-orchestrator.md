# 0008: Typed in-house graph and orchestrator-judge instead of LangGraph

- **Status:** Accepted for the demo build (Lane G, 12 Nov 2026). Revisit only if the flow gains loops that reopen extraction.
- **Affects:** `apps/agent/src/graph`, `apps/agent/src/orchestrator`, `apps/agent/src/swarm`, `apps/agent/src/context`, `apps/agent/src/prompts`, `apps/agent/src/experiment`, [EXPERIMENT-SWARM.md](../EXPERIMENT-SWARM.md)
- **Related:** [0006](0006-model-boundary-and-providers.md) (model boundary), [0002](0002-plain-multisign-core.md) (two-key payment path)
- **Journal:** D-099, D-100 in [DECISION-JOURNAL.md](../logs/DECISION-JOURNAL.md)

## Context

- `BUILD-BRIEF.md` requires prompt, context, swarm and graph engineering, and names LangGraph.js for orchestration.
- The payment path must be auditable: every step that can reach the ledger must be one that the code allows.
- Research R5 (`docs/research/R5-agent-architecture.md`, branch `claude/research-r5-agents-e36d1c`, section 5.1) found that for a fixed five-step flow the framework adds a dependency without adding a guarantee: "keep the plain typed state machine". R5 also says that LangGraph's checkpointer gives durable resume, but that a crash after a payment reached the ledger is unknown, and only a person may reconcile it.
- The repository already has a typed transition table (`apps/agent/src/workflow/states.ts`) that refuses a move at write time, which LangGraph's graph does not do by itself.

## Options considered

| Option | Why not, or why yes |
|---|---|
| LangGraph.js | Adds a dependency and a runtime that chooses its own steps. Its checkpointer does not stop a resent payment. R5 section 5.1 recommends against it for this flow. |
| Keep only the existing `processInvoice` sequence | Right for payment, but it has no reviewers, no route policy and no judge. The brief requires them. |
| **A typed in-house graph (`edges.ts`), with a pure judge and a versioned route table** | Chosen. Every move is an edge in one table, checked before it happens. The judge can only pick edges the table names. Checkpoints are written per transition. About 1,000 lines, all tested. |

## Decision

1. **One graph, typed.** `NODES`, `EDGES` and `TERMINALS` are one table (`graph/edges.ts`). `assertEdge` throws on any move not in it. Terminal states are `paid`, `held`, `refused`, `needs-person`, and `eligible` (eligibility-only runs).
2. **The judge is a pure function.** `judge(input)` returns ACCEPT, REPAIR, ADD_REVIEWER or HOLD. It has no field for model confidence. The same input always gives the same action. Each action maps to one edge (`JUDGE_EDGE`). A HOLD goes only to the held terminal, and nothing in the judge can reach a payment node except through ACCEPT.
3. **The route is a versioned table, first match wins** (`orchestrator/route-policy.ts`, `route-v1`). Inputs are facts code already knows. A model never chooses a route.
4. **Budget is enforced in code.** Three initial calls (extractor, procurement reviewer, fraud reviewer) and one repair, shared. The count is written to a checkpoint before each call, so a restarted run cannot exceed it. The reason draft uses the repair slot only when it is unused.
5. **Checkpoints.** One JSON file per transition, written atomically. A killed run resumes from the newest checkpoint. A run whose submit intent was written but whose result was not is never sent again: it goes to `needs-person` (`SUBMIT_OUTCOME_UNKNOWN`). Tested with a crash that is thrown during the ledger call.
6. **Memory.** Short-term state is per invoice and frozen as it is written. Long-term facts are read-only and can be written only from a `ValidatedOutcome`, which only code can create. The swarm and the judge never import the writer (a test checks the source).
7. **Evidence graph.** `graph/evidence.ts` writes JSON with supports and contradicts edges, sorted by id. Quote text is kept as hashes.

## Deviations from the plan's order (stated, not hidden)

- **Route runs after verify, not before extract.** The route needs the printed payee account (bank change) and the verified total (amount band). Both exist only after extraction. Before extraction the route could use only the sender check and prior holds, and the bank-change rule would be blind.
- **Payment nodes are a port.** `PaymentPort` (warden, sign, submit, reconcile) is the seam. The production adapter that wraps `WardenPort` and `AgentSigner` is **not wired** in this change. The existing `processInvoice` path remains the one that pays. A test shows the graph's ordering and the no-resend rule against a fake port only.
- **Decision log is separate.** The graph writes its own hash-chained JSON lines (`graph/decision-log.ts`), with prompt hashes and policy versions. The lane-owned transition log's schema does not carry prompt hashes, so folding the two is a follow-up.
- **Extractor prompt.** Lane A's `extract.ts` holds its own system prompt. `prompts/v1/extractor.md` is the versioned copy. The hash recorded in the log is of the file, not of the string sent, until lane A loads the file. This is a known gap, recorded in the test log.

## Consequences

- **Easier:** every path to a payment is readable in one table. A reviewer can see that a fraud HOLD cannot be overridden, and tests show it.
- **Harder:** no framework features (visualisers, time travel, interrupts UI). The console must read the checkpoint files and the evidence JSON directly.
- **Cannot claim:** that the swarm is better than one prompt. That is answered only by [EXPERIMENT-SWARM.md](../EXPERIMENT-SWARM.md), under the three gates.

## Evidence required

- Unit and graph tests: `apps/agent/test/graph`, `apps/agent/test/context-swarm` (TEST-LOG).
- The kill-and-resume test and the no-resend test (TEST-LOG).
- The experiment on the fictional set, with failure counts and intervals (EXPERIMENT-SWARM.md).
