# Governance

Status: **draft, partly built.** Each control below says whether it is in code, in a test, or only written down. Nothing here is certified.

## 1. Segregation of duties

| Role | Can | Cannot |
|---|---|---|
| Agent (model) | Read invoices, propose a match and a payment | Sign, approve, change limits, change policy |
| Warden (independent signer) | Approve or hold each proposal against policy and ledger | Change its own policy; sign without the agent's signature |
| Operator | Set limits, pause, resume, arm, disarm | Approve a limit increase alone |
| Second approver | Co-sign any limit increase | Be the same person as the operator who proposed it |

Evidence: the Warden's operator routes refuse agent identities (see [SECURITY-LOG.md](logs/SECURITY-LOG.md) S-051). A self-approval test is still to be written; until it is, this row is **not verified**.

## 2. Versioning and change control

- **Policy file, route table and prompt** are versioned. The policy version is in every decision record.
- **Prompt hash:** the registered prompt is `apps/agent/prompts/v1/extractor.md`. Lane G's hand-over notes that `extract.ts` still holds its own copy of the prompt, so the logged hash may not match the string sent. **Open defect; not fixed here.**
- **Rule:** no model or prompt change ships without passing the evaluation (`npm run eval`). The eval result is recorded in the model register below.
- Changes go by pull request into `demo/integrated`, with a DECISION-JOURNAL entry.

## 3. Model governance register

| Model | Provider | Use | Prompt hash | Eval result | Date | Record |
|---|---|---|---|---|---|---|
| Extraction model (per `apps/agent` config) | per ADR 0006 | Invoice field extraction | not yet recorded per run | see EVALUATION.md | 2026-11-12 | [ADR 0006](decisions/0006-model-boundary-and-providers.md) |
| Meta Llama family | Meta (open weights, via a host) | Under evaluation | n/a | n/a | n/a | [ADR 0008](decisions/0008-typed-graph-and-orchestrator.md) |

The register is incomplete: the per-run prompt hash is not stored with each decision yet. ADR 0008 holds the Meta decision. Treat the Meta row as a placeholder until its eval is run.

## 4. Data policy

- **Fictional data only** goes to free tiers. The labelled set and generated invoices are fictional (`sim_` identifiers).
- **Real invoices** need redaction before a model sees them, and a provider contract with no training on customer data. Redaction of personal identifiers in logs is tested (`packages/shared/test/logging/redact.test.ts`); redaction before a model call is **not built**.
- **POPIA** (South Africa) and the **Zambia Data Protection Act** apply to real personal data. Both are for counsel. See [COMPLIANCE.md](COMPLIANCE.md).

## 5. Retention

Decision records and audit exports are kept at least five years, the period the draft FIC crypto manual gives for provider records (see COMPLIANCE.md). No deletion job exists. Personal data beyond what payment and compliance need should not be collected; the rule is not yet enforced in code.

## 6. Incident runbook (short form)

1. **Detect:** Warden HOLD or REFUSE spike, watchdog pause, sanctions HOLD, sender HOLD, or a log-redaction failure.
2. **Contain:** pause the Warden from the operator console (or STOP the process if the console is down). No payment proceeds while paused.
3. **Record:** log the time, the proposal IDs and the reason code in SECURITY-LOG.
4. **Decide:** a person clears or rejects each held item. Sanctions and sender holds are never cleared by the agent.
5. **Review:** add a test for the failure and a DECISION-JOURNAL entry.

## 7. Kill-switch drill

Plan: pause the Warden through the operator route, then stop the process with the console stopped, and check that no payment is submitted. **Status: not yet run.** The result will be logged in TEST-LOG when it is.
