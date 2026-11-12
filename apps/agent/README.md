# apps/agent

The invoice agent. It reads a text PDF, extracts each field with the exact text it came from, checks the values against the buyer's own records, and proposes a payment to the Warden. It holds no payment key and cannot submit a transaction on its own ([RULES.md](../../docs/RULES.md), rule R-6). Gate C of the build ([ISSUES.md](../../docs/ISSUES.md), C1 to C7) is built here. Live runs with a model provider and a running Warden are not yet recorded ([TEST-LOG](../../docs/logs/TEST-LOG.md) T-087, T-088).

## What the workflow does, in order

1. **Intake (C1).** The watched inbox is polled. Each file is read once and fingerprinted by the SHA-256 of its bytes. Only a regular file holding a text PDF of up to 10 MB is accepted. The PDF is parsed in a child process with an empty environment, a 20-second limit and a 4 MB output cap. Anything else is quarantined.
2. **Screen (C3).** The text is checked for steering: instruction-like phrases, hidden characters, markup and claims that the payee changed. A flagged document is quarantined, and no model reads it.
3. **Extract (C2).** One model call, with the invoice text between marker lines that carry a random id. The reply must match a strict schema. Each field comes with its exact quote. One repair call is allowed only if the first reply does not parse.
4. **Verify (C2).** Code finds each quote on exactly one page, checks that the value is inside the quote, reads dates and currency under fixed rules, and parses amounts under the money rules. A field that cannot be verified is held, with its reason.
5. **Match.** The invoice is found by its file fingerprint in the buyer's invoice record. The supplier, invoice number, currency, amount, purchase order, goods receipt and printed account are compared with the buyer's records. An obligation that may already be paid is held.
6. **Warden (C7).** The agent proposes the payment terms only. The Warden decides, and the agent co-signs only the exact transaction the Warden built.
7. **Submit and reconcile (C7).** The co-signed transaction is submitted through the Warden. A lost or unreadable answer goes to reconciliation. It is never resent blind.

Every move is written to the decision log before the next step runs. Each entry names the actor, the reason, the policy version and the hashes of the evidence used. It never holds quote text, account numbers or keys ([DECISION-JOURNAL](../../docs/logs/DECISION-JOURNAL.md) D-067).

## Layout

- `src/intake/` file intake, polling, and the PDF child process (`pdf-child.mjs`)
- `src/screen/` the injection screen
- `src/extract/` the extraction prompt, verification, dates and currency
- `src/match/` matching and the supplier master
- `src/model/` the provider boundary, the chat client and the call budget
- `src/workflow/` the state table, the pipeline and the Warden port
- `src/log/` the decision log and the run lock
- `src/audit/` the audit export and the Warden event reader
- `src/eval/` the labelled-set loader, the harness, the baseline, the stand-in model and the report
- `src/main.ts` the command line (not unit-tested; its parts are)
- `fixtures/labelled/` 30 fictional invoices: PDFs, labels, buyer evidence and supplier master
- `tools/` the fixture generator and its PDF writer
- `results/` evaluation reports (simulated runs are labelled as such)

## Commands

Build the labelled set (deterministic; the output is committed):

```bash
npm run agent:build-set
```

Evaluate with the rule-based stand-ins (fixture mode). No provider key is needed. The report says FIXTURE, and it measures the code checks, not any model:

```bash
npm run eval
```

Evaluate with a provider model. Set the provider's key in your environment first. Only fictional data is evaluated:

```bash
npm run agent:eval -- --mode live --provider openrouter
```

Run the agent on the inbox against a Warden. Set `SIGNOFF_AGENT_ID`, `SIGNOFF_AGENT_SECRET` (hex) and `SIGNOFF_AGENT_SEED` in your environment, together with the provider's key. Real invoices also need `--data real --zero-retention-ack <provider>`, and never a free-tier model:

```bash
npm run agent:run -- --inbox apps/agent/inbox --log apps/agent/state/agent-log.jsonl --evidence <evidence.json> --suppliers <suppliers.json> --warden-url <warden URL>
```

Export the audit trail for one payment (a 64-character lower-case obligation key), with the Warden's event log if you have it:

```bash
npm run agent:export -- --log apps/agent/state/agent-log.jsonl --obligation <64-hex> --warden-log <warden-events.jsonl> --format csv --out audit.csv
```

## Models and data

- Providers: OpenRouter and Hugging Face, through their OpenAI-compatible APIs. Anthropic and Claude models are refused by policy ([ADR 0006](../../docs/decisions/0006-model-boundary-and-providers.md)).
- Defaults, read from the public lists on 2026-11-10: `google/gemma-4-31b-it:free` on OpenRouter, and `google/gemma-4-31B-it:deepinfra` on Hugging Face. Re-check an identifier before a live run.
- Keys are read from `OPENROUTER_API_KEY` or `HF_TOKEN` at run time, and are never stored or printed.
- Real invoices need the operator's confirmation of the provider's zero-retention terms. Free-tier models are refused for real invoices (S-032).

## What is verified, and what is not

- **Verified in software:** every test in [TEST-LOG](../../docs/logs/TEST-LOG.md) T-076 to T-086 passes, and the global coverage thresholds hold.
- **Fixture:** `results/fixture-eval.md` is produced by rule-based stand-ins, not by a model. It shows the pipeline's checks on 62 fictional invoices against a single-prompt baseline, and it is not a measure of any model. See `docs/EVALUATION.md`.
- **Unverified:** the live model accuracy (T-088). The live Warden integration on the Testnet (T-087). Provider data handling. Performance on real invoices.
- **Held by design:** South African space-grouped and European amount layouts (D-070). This is a measured over-blocking risk for the target customer.
