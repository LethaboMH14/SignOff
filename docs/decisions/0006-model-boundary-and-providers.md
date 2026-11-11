# 0006: Model boundary and providers for the agent

- **Status:** Proposed
- **Affects:** `apps/agent` (model layer, extraction, evaluation), [AGENT-RELIABILITY.md](../AGENT-RELIABILITY.md), [TRUST.md](../TRUST.md) (model boundary)
- **Rules touched:** R-6 (the agent holds no payment keys and only proposes), R-12 (no secrets or personal data in code, logs or prompts beyond need), R-22 (AI tools never receive secrets or real personal data), in [RULES.md](../RULES.md)
- **Journal:** D-061, D-063, D-066, D-069 in [DECISION-JOURNAL.md](../logs/DECISION-JOURNAL.md)

## Context

- On 2026-11-10 the user asked for free open-source models through OpenRouter and Hugging Face, for Meta models on the user's own credits, and for no Claude models.
- On 2026-11-10 the user dropped Hugging Face, added keys for Groq, Gemini, OpenRouter and Meta, and asked for few calls to the Meta API. One minimal probe per provider confirmed each default identifier on that day. Gemini `gemini-2.5-flash` returned HTTP 404 and `gemini-3.5-flash` answered. OpenRouter's `google/gemma-4-31b-it:free` returned HTTP 429 twice, and `nvidia/nemotron-3-ultra-550b-a55b:free` answered. Meta's `muse-spark-1.3` cut off a 64-token reply, and answered at 512 tokens.
- The brief fixes the workflow, requires strict structured output, caps the model at three calls per invoice, and treats invoice text as hostile data (`BUILD-BRIEF.md`).
- The public lists read on 2026-11-10 show: OpenRouter with 469 models, including `:free` variants and Meta Llama 3.3 70B at a low paid price that supports structured outputs; Hugging Face with 127 models, none flagged free, and 111 providers that support structured output.
- Free and credit-funded access may keep prompts or use them for training. Those terms are set by the provider and are not verified here.

## Decision

1. **One boundary.** Every model call goes through a `ModelClient` interface. The only implementation is an OpenAI-compatible chat completions client over `fetch`. No provider SDK is added.
2. **Four providers.** OpenRouter, Groq, Gemini and Meta, with the defaults listed in the agent README. Hugging Face is retired. Anthropic and Claude identifiers are refused in code.
3. **Keys stay in the environment.** `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` and `META_API_KEY` are read at run time. They are never stored, logged or echoed. A missing key is reported by variable name only. Meta's address comes from `META_API_BASE_URL`, which must be https with no credentials, query or fragment.
4. **Few calls.** One call per invoice, plus one repair call only when the first reply does not parse. A budget of three is enforced in code, and a failed call holds the invoice. There are no automatic retries, because a retry would spend the budget.
5. **Strict replies.** Where a model supports JSON Schema output, the schema is requested. Every reply is validated locally against the strict schema either way, and an invalid reply is never used.
6. **Data.** Real invoices reach a model only after the operator confirms that provider's zero-retention terms. Free-tier identifiers are refused for real invoices. The labelled evaluation uses fictional invoices only.
7. **Measure before claiming.** Changing a provider or a model means re-running the labelled evaluation in live mode and recording the result in the test log before any claim is made.
8. **Few calls to Meta.** On the user's instruction (2026-11-10), the Meta API is used for probes only, never for the labelled evaluation. Each probe is one call with a small prompt, and the number of probes is recorded in the test log.
9. **Pacing.** A live run may space its calls with `--min-interval-ms`, so free tiers are not overrun by a burst. The spacing is a setting of the run and is recorded with its result.

## Alternatives considered

| Option | Why not |
|---|---|
| Anthropic API | Refused by the user's instruction on 2026-11-10 |
| An SDK per provider, or the OpenAI SDK pointed at OpenRouter | Adds a dependency tree for one HTTP call. The boundary is about 150 lines and is easier to audit than an SDK |
| A local open-weight model on the agent's host | No hardware or operations are in scope, and latency and upkeep would be ours |
| One fixed model | Hides provider changes. The evaluation compares models instead |

## Consequences

- **Easier:** changing a model is configuration. Every call is counted and logged by identifier. No SDK upgrade needs tracking.
- **Harder:** provider differences in structured output are handled by configuration, not by the SDK. Free tiers are rate-limited, and a rate-limited call holds the invoice (fail closed). Without retries, a transient failure costs a hold and a person's time.
- **Cannot claim:** any model's accuracy until it is measured live (TEST-LOG T-088). Any provider's data handling. That a provider enforces the schema for every model.

## Evidence required

- A live evaluation with the chosen models, recorded in the test log with sample sizes, intervals and false approvals. Three providers ran on one sample each (T-092 to T-094). The pipeline held most invoices, so no accuracy claim is made.
- The operator's written confirmation of zero-retention terms for each provider before any real invoice (S-032).
- A re-check of each model identifier against the provider's public list immediately before a live run.
