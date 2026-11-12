# 0008: Meta as a full provider, a hard spend cap, and failover

- **Status:** Accepted (2026-11-12). **Partly supersedes** [0006](0006-model-boundary-and-providers.md), decisions 2, 4 and 8.
- **Affects:** `apps/agent` (model layer: providers, failover, spend caps, extraction), [AGENT-RELIABILITY.md](../AGENT-RELIABILITY.md)
- **Rules touched:** R-6 (the agent holds no payment keys and only proposes), R-12 (no secrets in code, logs or prompts), R-22 (AI tools never receive secrets or real personal data), in [RULES.md](../RULES.md)
- **Journal:** D-099 to D-101 in [DECISION-JOURNAL.md](../logs/DECISION-JOURNAL.md)

## Context

- On 2026-11-12 the owner confirmed in the main session: "Yes, use Meta fully". Meta's API key carries paid credit of about $5. ADR 0006 limited Meta to a few probes, so this changes that decision.
- Live runs on 2026-11-12 showed two causes of failed invoices, both in the model layer and not in the invoices:
  - **Reasoning models cut off.** A Meta model (`muse-ember-1.0`) spent 1,001 of a 1,200-token reply on hidden reasoning, and the reply stopped with `finish_reason=length`. With `reasoning_effort: low` and the JSON schema, the same invoice finished with 184 reasoning tokens and 372 completion tokens (probe, 2026-11-12). Meta's documentation for this model does not confirm the control, so the setting is recorded as observed, not as documented.
  - **Daily quotas.** Gemini's free tier allows 20 requests a day for the model used. Groq's free tier allows 200,000 tokens a day for `openai/gpt-oss-120b`, and that limit was reached on 2026-11-12. Both were classed as a generic rate limit, so the agent retried them. They are now a separate class that moves on without a retry.
- Meta's live `/models` list (checked 2026-11-12) has ten Muse-family ids and no Llama model. Meta publishes no price in that list. The price used for the spend cap is the OpenRouter list price for the same model, as a proxy.

## Decision

1. **Meta is a full provider.** It is first in the failover order (`FAILOVER_ORDER`), with the default model `muse-ember-1.0`, which is verified against Meta's own live list. A model id is changed only after checking that list (owner's instruction, 2026-11-12). The model is called with `reasoning_effort: low` and a JSON schema, and with a reply limit of 8,000 tokens (the other providers keep 4,000). The larger limit is part of the per-attempt worst case, so the caps see it.
2. **Hard spend cap in code.** Two caps are enforced before each attempt, against its worst-case cost (prompt measured conservatively, plus the full output limit), and then settled to the actual cost:
   - **Per invoice:** $0.05 by default (`DEFAULT_INVOICE_USD`). A call that would pass it is not sent, and the invoice is held with `SPEND_CAP`.
   - **Per day, in total across providers and runs:** $3 by default (`DEFAULT_DAILY_USD`). The count is kept in a file under the user's local application data, so a second run does not reset it. A call that would pass it is not sent, and the run stops with `DAILY_CAP`.
   A provider with no list price on record is not used once a cap applies, because its cost cannot be bounded.
3. **Failover with one retry per provider.** Each provider gets at most two attempts, and a retry is made only for a transport class (timeout, network, rate limit, server error). A daily quota is not retried. Retry-After is honoured up to a ceiling. A chain is capped at four attempts per logical call. The per-invoice call budget of three logical calls is still enforced in code, and it is now counted separately from attempts.
4. **Hugging Face is listed again** as a failover provider after the paid providers, with the default `openai/gpt-oss-120b` on the HF router. Its price is not on record, so it is skipped while a cap applies, as described in point 2. The reinstatement is recorded in PR #76 (per the lane message; not checked here).
5. **Reply budget.** A reasoning model must have its reasoning limited (`reasoning_effort: low`) and its reply limit sized for the reasoning it still does (4,000 tokens for extraction). A cut-off reply is class `LENGTH`, and it is not repaired, because a repeat would give the same cut.

Decisions 1, 3, 5, 6, 7 and 9 of ADR 0006 are unchanged.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep Meta to probes | The owner now funds it, and the labelled evaluation needs it |
| Count the spend in calls only | Calls do not bound cost: a reasoning model's cost varies with its reasoning. The cap is in dollars |
| A provider SDK or LiteLLM | Would add a dependency tree for a few HTTP calls, and LiteLLM is Python. Recorded in D-099 |
| Retry every class | A daily quota or an invalid request gives the same answer, and the retry spends budget |

## Consequences

- **Easier:** Meta can be run live on the full labelled set within a bound that is known before the run starts.
- **Harder:** the price used for Meta is a proxy, and Meta's real price may differ. The cap is therefore a bound on what the run may spend, not a measurement of Meta's bill. The owner should compare the two after the run.
- **Cannot claim:** that Meta's reasoning control is documented by Meta, or that a provider's data handling is acceptable for real invoices. Free-tier and credit-funded terms are set by each provider and are not verified here.

## Evidence

- Root-cause probe, `muse-ember-1.0`, invoice clean-02, 2026-11-12: 1,200 tokens without a low-effort setting gave `finish=length` with 1,001 reasoning tokens. With low effort and the schema, `finish=stop` with 184 reasoning tokens (raw calls, not logged).
- Spend-cap and failover tests in `apps/agent/test/model/` (spend, failover, error classes), 432 agent tests passing.
- The live run on the full labelled set on Meta: `apps/agent/results/live-meta.md`, with its sample size, intervals and cost.
