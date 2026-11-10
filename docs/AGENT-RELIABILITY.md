# Agent reliability: handling hallucination

**Planned design. Nothing here is built or measured yet.**

The design assumes the agents will sometimes hallucinate. The goal is that a hallucination can only cause a hold, never a wrong payment. **"No wrong payment reaches the ledger" is a test target to be measured, not a guarantee.**

Hallucination is also not the main risk. A model that extracts perfectly can still propose a fraudulent invoice if the supplier list, purchase order or delivery record is wrong. Those threats are in [TRUST.md](TRUST.md#threats-from-upstream-of-the-agent).

## 0. A workflow, not a free-roaming agent

Anthropic's guidance is to use the simplest design that works, and fixed workflows where the task is well defined and predictability matters ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)). Paying an invoice is well defined. So SignOff's sequence is fixed in code; the model is called at set points and never chooses its own next step or tools. In Anthropic's terms this is prompt chaining with programmatic checks between steps.

Other practices taken from that guidance and the API documentation:

- **Strict, schema-enforced output** for extraction, so every response parses ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). Hand-check the schema features actually enforced.
- **Tools designed as carefully as prompts:** few tools, clear names, examples and boundaries. The agent's only write tool is `propose_payment`; everything else is read-only.
- **Make mistakes hard:** amounts as integer minor units and currency codes, supplier referenced by enrolled identifier only, never a free-text account.
- **Prompts and tool schemas versioned** and recorded with every decision.
- **Stopping rules:** fixed number of model calls per invoice (at most three); on reaching it, hold.
- **Evaluate on many examples** before trusting a change, as below.

## 1. The model decides as little as possible

| Job | Done by |
|---|---|
| Read the invoice and extract supplier, invoice number, amount, date, line items | Model |
| Match to the purchase order and goods-received record | Code |
| Decide pay or hold | Warden's fixed rules |
| Choose the destination account | Warden, from the verified supplier record, never from the invoice |
| Sign and submit | Two keys and the ledger |

A hallucinated bank account cannot be paid, because the destination never comes from the model.

## 2. Every extracted value points to its source

- The model returns each field with the exact text it came from, in a fixed format validated by a schema (Zod).
- Code checks that the quoted text really appears in the invoice. If not, the field is rejected.
- Code parses the amount again from the quote. If it differs from the model's number, the invoice is held.

A real quote shows the value appears in the document. It does **not** show the document is true; a forged invoice quotes its own forged numbers.

## 3. "I don't know" is allowed

- The prompt instructs the model to leave a field empty when the invoice does not clearly state it.
- An empty required field is a hold, with the reason shown to the operator.

## 4. Cross-checks the model cannot influence

- Amount matches the purchase order and goods-received record.
- Supplier matches a verified, enrolled supplier (mandatory). An XRPL credential on the supplier's account is optional and only required if a separate policy says so.
- Invoice number has not been paid before.

All of these records are held by Warden and are the source of authority. No model output or score can override a failed check against them.

## 5. A second, different check

Two extraction runs can agree on the same wrong value, so agreement is not proof. The plan is to benchmark two options within the brief's cap of three model calls per invoice:

- two extraction runs compared field by field, any disagreement held;
- one extraction plus a separate, targeted reviewer that checks specific risks, followed by the deterministic checks.

The one with fewer false approvals on the test set is used. Agents are not added just to have more of them.

## 5a. Evidence status, kept separate

Each invoice carries four separate results, never merged into one score:

| Result | Values |
|---|---|
| Field evidence, per field | exactly verified / ambiguous / missing / conflicting |
| Document trust | known channel and unaltered file, or not |
| Hard controls | pass or fail, each named |
| Fraud-risk estimate | measured on the test set before it is used |

An invoice is eligible for Warden only if every hard control passes and every required field is exactly verified. Anything else is held. A model's stated confidence is not treated as a probability.

## 6. The invoice is hostile input

- Invoice text is passed as data, clearly separated from instructions.
- Even a fooled model has no payment tool, no keys and no way to change supplier records.

## 7. Measurement

- A labelled test set of invoices: clean, messy, with hidden instructions, with missing fields.
- Scored per run: field-level precision and recall, fields invented, fields correctly left empty, **false approvals** (the critical number), false holds, latency and cost.
- Reported with sample sizes and confidence intervals. Zero false approvals in a small sample is not proof of zero risk.
- If a risk score is used, its calibration is measured (for example Brier score) before any threshold is set.
- Test cases include altered supplier records, forged purchase orders, revoked credentials, amount or currency mismatches, prompt injection, duplicates, and legitimate invoices to measure over-blocking.
- Compared with a single-prompt baseline before claiming an improvement, as the brief requires.
- Re-run after every prompt or model change; results published in the repository.

## Not covered

- An invoice that is internally consistent but fraudulent, such as overcharging that matches a wrong purchase order. That is a process problem, not a hallucination.
- Scanned or handwritten invoices. The demo is limited to text PDFs.
