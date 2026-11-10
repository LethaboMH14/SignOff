# Service levels and the fastest path to them

**Planned targets. Nothing is built or measured yet.** Numbers marked *target* become claims only once measured, as described in [ENGINEERING.md](ENGINEERING.md#evidence-for-each-test).

## What "service level" means for SignOff

For a payments product, the most important level is not uptime. It is correctness: **no wrong payment, no double payment, no payment shown as paid that was not.** Availability and speed come second, because the safe failure is a hold, which a finance team can live with.

## Service level objectives

| # | Objective | Target | Measured how |
|---|---|---|---|
| 1 | Payments made that violate a hard control | **0** | Attack suite and labelled test set; every case recorded |
| 2 | Duplicate payments for one invoice | **0** | Concurrency, retry, edit and re-upload tests; one stable obligation identity per payable |
| 3 | Invoices shown "paid" without a validated ledger result and matching delivered amount | **0** | Reconciler tests, including timeouts and restarts |
| 4 | Every decision traceable to evidence, policy version and ledger hash | 100% | Audit export checked against the state log |
| 5 | Time from invoice arrival to decision (paid or held), clean invoice | *target* under 60 seconds at the 95th percentile | Timed runs on the test set |
| 6 | Ledger settlement after submission | *target* under 10 seconds typical | XRPL validates in about 3–5 seconds; measured on Testnet |
| 7 | Operator pause takes effect | Next proposal refused; *target* under 5 seconds | Test: pause, then propose |
| 8 | Lowered limit takes effect | Next proposal; no grace period | Test: lower limit, then propose |
| 9 | Demo availability during judging | Live path works; recorded backup ready | Rehearsal on 12 November; health checks |
| 10 | False holds on legitimate invoices | Measured and reported; no fixed target yet | Test set |

Objectives 1–4 are **hard release blockers measured on the test set**: a single failure in testing blocks release. Zero in testing is not a guarantee of zero in use; each result is reported with the scope of the test set (number and kinds of cases). Objectives 5–10 are **soft**: misses are reported, not hidden. False holds on legitimate invoices (objective 10) are always measured alongside, so safety is not bought by holding everything.

Correctness is preferred over availability. When a dependency fails, SignOff holds the invoice and says why, rather than guessing.

## Fastest path: what gives the most reliability per hour

Ranked by value for the time it costs, for a build due 13 November.

| Rank | Measure | Why it is high value | Rough effort |
|---|---|---|---|
| 1 | **Workflow, not a free-roaming agent.** Code fixes the sequence: extract, check, decide, sign. The model fills one step. | Anthropic's own guidance: use the simplest solution, and workflows for well-defined, predictable tasks ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)). Removes whole classes of failure. | Saves time |
| 2 | **Strict structured output for extraction** (schema-enforced tool input) | Output always parses; no retry loops on malformed JSON ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) | Low |
| 3 | **XRPL reliable submission** done exactly as documented | Prevents double payment and false "paid" ([reliable submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission)) | Medium; needed anyway |
| 4 | **A stable obligation identity and an atomic reservation** in the database | Prevents duplicates under retries and concurrency | Low |
| 5 | **Fail closed everywhere** | Any missing dependency becomes a hold, never a payment | Low |
| 6 | **Two ledger nodes with failover** | Testnet nodes do go down; switch to a second public node | Low |
| 7 | **Model call retries with backoff, then hold** | Rate limits and overloads become a short delay or a hold | Low; SDK support |
| 8 | **Health endpoints and one synthetic check** that runs a Testnet payment end to end | Catches a broken demo before a judge does | Low |
| 9 | **Scripted Testnet re-provisioning** | Testnet can be reset; rebuild accounts, trust lines and signer list in one command | Medium |
| 10 | **Fixture mode, clearly labelled, and a recorded backup video** | If the network or model is down during judging, the demo still runs honestly | Low |

Deliberately left out for now, because they cost more time than they return before 13 November: multi-region deployment, queues and worker fleets, custom monitoring stacks, and more agents.

## How each dependency fails, and what SignOff does

| Dependency | Failure | Behaviour |
|---|---|---|
| Model API | Rate limit, overload, timeout | Retry with backoff a fixed number of times, then hold with reason "extraction unavailable". Never pay on a partial result. |
| Model output | Missing or ambiguous field | Hold ([AGENT-RELIABILITY.md](AGENT-RELIABILITY.md)) |
| Ledger node | Unreachable | Fail over to a second node. The transaction keeps its exact hash, sequence and expiry, and its obligation and attempt identities; outcomes are confirmed from validated history before any status change. If both nodes fail, Warden refuses and invoices hold. |
| Ledger | Submission result unclear | Keep querying until the transaction's `LastLedgerSequence` has passed with full history; only then decide it failed. Never resubmit blindly. |
| Ledger | A different transaction used the expected sequence | Stop, alert the operator, investigate before sending anything |
| RLUSD trust line | Frozen by the issuer, or funds clawed back | Detected on the pre-signing ledger read; hold all payments from that account and alert |
| Warden | Down | Agent cannot pay; invoices queue as proposed |
| Database | Unavailable | Warden refuses; nothing is signed without a durable reservation |
| Operator console | Down | Payments continue under the current policy only if an independent, authenticated pause route to Warden exists **and has been tested**. Until then, console down means Warden pauses itself. |

## XRPL submission rules (from the official procedure)

1. Every transaction carries `LastLedgerSequence` set a few ledgers above the latest validated one (the docs suggest 4 for automated systems).
2. Read the sequence from the latest validated ledger.
3. **Persist** hash, sequence, `LastLedgerSequence`, sender and the invoice it belongs to **before** submitting.
4. Treat the submit response as provisional.
5. Final only when the transaction is in a **validated** ledger. Only `tesSUCCESS` with the expected delivered amount means paid.
6. Not found after `LastLedgerSequence`, with continuous history: it failed and can never appear; a replacement may reuse the sequence.
7. Included but failed (`tec…`): the fee is spent; do not retry unchanged.
8. Gaps in the node's history: no conclusion until filled or checked against another trusted node.
