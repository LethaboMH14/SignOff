# R9: Open-source tools for SignOff

- **Status:** Research. Documents only. No code, dependency or configuration changed.
- **Date:** 12 November 2026. Deadline for the build: 13 November 2026, 23:59 SAST.
- **Question:** Which open-source GitHub tools could make a model or agent do these tasks better or more cheaply, regardless of which model is used, for SignOff's invoice-to-payment flow?
- **Sources:** GitHub REST API (`gh api repos/<owner>/<repo>`) read on 12 November 2026 for stars, licence, last push, archived flag and language. READMEs read through the same API. Licence text read where the API reported `NOASSERTION`. SignOff code and decisions read from `origin/feat/console-redesign`.

## Limitations (read first)

1. **No tool was installed or run.** Nothing here measures accuracy, speed or cost. Every "beats" or "cheaper" statement is unverified until a labelled run is recorded in the test log (rule R-2 and ADR 0006, item 7).
2. **Star counts and push dates are a snapshot** from the API at the time of reading. A push date is the last push, not the last release.
3. **Licences.** The API reported `NOASSERTION` for MinerU, Vercel AI SDK, Langfuse and NeMo Guardrails. Their licence files were read where noted. Model weights can carry a different licence from the code (Marker and Surya list OpenRAIL-M); those weights were not reviewed.
4. **Windows CPU.** No Windows machine was used. "Runs on CPU" is taken only from a README quote, and "unverified" otherwise.
5. **Coverage is partial.** Searches of GitHub topics returned mostly small, unlicensed or student projects. Finance-agent benchmark coverage is thin, and third-party claims about leaderboards were not checked.
6. **Model-side tools were judged on fit, not on quality.** Whether a cheap or free model does better with a tool is a question for the labelled evaluation, not for this document.

## What SignOff does now (ground truth)

Read from `origin/feat/console-redesign`:

- The agent is described as: "It reads a text PDF, extracts source-cited fields, checks them against the buyer's evidence and proposes a payment." (`apps/agent/package.json`). So scanned, image-only invoices are outside the current scope.
- Dependencies: `pdfjs-dist` 6.5.438 and `zod` 4.6.7 (`apps/agent/package.json`).
- Extraction makes one model call. The reply schema is generated from the shared Zod schema with `z.toJSONSchema` (`apps/agent/src/extract/extract.ts`). A repair call happens only when the first reply does not parse.
- Every extracted value is checked in code against the document: "A value counts as verified only when the quote the model gave is found in the document, the value is in that quote, and the value means what the quote says." (`apps/agent/src/extract/verify.ts`).
- Model calls go through a hand-written OpenAI-compatible client over `fetch`, with no provider SDK (`apps/agent/src/model/chat-client.ts`, ADR 0006).
- Prompt-injection screening is a fixed rule set: "The screen is a fixed set of rules. It catches the patterns it names, and nothing more." (`apps/agent/src/screen/injection.ts`).
- The workflow order is fixed in code: "The model is called at one point only, and never chooses a step." (`apps/agent/src/workflow/pipeline.ts`).
- Duplicate and payee controls are deterministic. R-7: "Payee accounts come only from verified supplier records."

Gaps that a tool could fill: scanned invoices (no OCR path), table-heavy text PDFs (the quote check depends on text order), injection testing beyond the labelled fixtures, and PII redaction before a real invoice reaches a hosted model (R-22).

## Dependency rule applied

The repository's rule is in `docs/logs/DECISION-JOURNAL.md`:

- **D-012:** "7-day cooldown on new dependency versions, exact pins, and a logged exception for security fixes."
- **D-069** records the one agent dependency added so far (`pdfjs-dist`): "It was published 2026-11-01, nine days before adoption, which meets the seven-day rule in D-012." Each dependency needs a journal entry with its reason and the alternatives rejected.
- **D-080** shows the bias: "Add the `dotenv` package (a new dependency for one file)" was rejected in favour of a small reader.
- **ADR 0006** rejects an SDK per provider: "Adds a dependency tree for one HTTP call."

Every "add" below therefore needs: an exact pin, a publish date at least seven days before adoption, a journal entry, and a licence compatible with an MIT repository. Copyleft licences (AGPL, GPL) are treated as incompatible for code the repository distributes.

Judging columns used below:

- **Beat or complement:** does it do something SignOff does not do, or do the same thing better?
- **Windows CPU:** a README quote about hardware, or "unverified".
- **Node call:** native TypeScript or JavaScript, an HTTP sidecar, or a CLI.
- **Licence:** from the API, checked against the licence file where needed.
- **Supply chain:** archived status, last push, maintainer concentration, and install-time code.

## A. Document parsing and OCR

| Tool | Repo | Licence | Stars | Last push | Archived | Language | What it does | README or description quote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docling | [docling-project/docling](https://github.com/docling-project/docling) | MIT | 70,474 | 2026-11-12 | no | Python | Parses PDFs and office files into structured documents | "Docling simplifies document processing by parsing diverse formats — including advanced PDF understanding — and providing seamless integrations with the generative AI ecosystem." |
| Docling Serve | [docling-project/docling-serve](https://github.com/docling-project/docling-serve) | MIT | 1,908 | 2026-10-30 | no | Python | Runs Docling as an HTTP service | "Running Docling as an API service" |
| MinerU | [opendatalab/MinerU](https://github.com/opendatalab/MinerU) | NOASSERTION (LICENSE.md: Apache-2.0 with added terms) | 83,548 | 2026-11-12 | no | Python | Converts PDFs and office documents to markdown or JSON | "Transforms complex documents like PDFs and Office docs into LLM-ready markdown/JSON for your Agentic workflows." Licence text: "MinerU may be used for commercial purposes without a separate commercial license. However, if you and your Affiliates, on a consolidated basis, meet either of t…" (truncated; the thresholds must be read in full) |
| Marker | [datalab-to/marker](https://github.com/datalab-to/marker) | Apache-2.0 (code); model weights OpenRAIL-M per badge | 40,879 | 2026-11-11 | no | Python | Converts PDFs to markdown, JSON, chunks and HTML | "Marker converts documents to markdown, JSON, chunks, and HTML quickly and accurately." Also: "Works on GPU, CPU, or MPS" |
| Surya | [datalab-to/surya](https://github.com/datalab-to/surya) | Apache-2.0 (code, LICENSE read); model weights OpenRAIL-M per badge | 21,593 | 2026-11-08 | no | Python | OCR, layout analysis, reading order and table recognition | "Surya is a 689M param OCR model with these features:" |
| PaddleOCR | [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 | 92,621 | 2026-09-16 | no | Python | OCR toolkit for PDFs and images, 100+ languages | "A powerful, lightweight OCR toolkit that bridges the gap between images/PDFs and LLMs." Badge: "hardware-cpu, gpu, xpu, npu" |
| olmOCR | [allenai/olmocr](https://github.com/allenai/olmocr) | Apache-2.0 | 19,821 | 2026-03-25 | no | Python | Converts PDFs and image documents to clean plain text | "A toolkit for converting PDFs and other image-based document formats into clean, readable, plain text format." Also: "(Based on a 7B parameter VLM, so it requires a GPU)" |
| Unstructured | [Unstructured-IO/unstructured](https://github.com/Unstructured-IO/unstructured) | Apache-2.0 | 15,723 | 2026-11-06 | no | Python (API reports "HTML", which looks wrong for this repo) | Partitions documents into structured elements for LLM pipelines | "Unstructured is open-source ETL solution for transforming complex documents into clean, structured formats for language models." |
| invoice2data | [invoice-x/invoice2data](https://github.com/invoice-x/invoice2data) | MIT | 2,245 | 2026-11-11 | no | Python | Template-based extraction from PDF invoices | "Extract structured data from PDF invoices" |
| Tesseract | [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) | Apache-2.0 | 77,481 | 2026-11-11 | no | C++ | Open-source OCR engine | "Tesseract Open Source OCR Engine (main repository)" |
| Tesseract.js | [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | Apache-2.0 | 38,832 | 2026-05-17 | no | JavaScript | OCR in JavaScript, for Node and the browser | "Tesseract.js is a javascript library that gets words in almost any language out of images." |
| Table Transformer | [microsoft/table-transformer](https://github.com/microsoft/table-transformer) | MIT | 2,947 | 2024-06-24 | **yes** | Python | Detects tables in PDFs and images | "Table Transformer (TATR) is a deep learning model for extracting tables from unstructured documents (PDFs and images)." |

Judgement:

| Tool | Beat or complement | Windows CPU | Node call | Supply chain and fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| Docling / Docling Serve | Complements. Could read tables and reading order that `pdfjs-dist` gives as raw text. Risk: its markdown changes text order, which the quote check depends on | Unverified (`pip install docling` in the README; heavy ML stack) | HTTP sidecar (`docling-serve`) | Python tree; large; new runtime to operate on a demo laptop | Document as production path for table-heavy PDFs |
| MinerU | Complements, same use as Docling | Unverified; README points to GPU acceleration | Python CLI or service | Commercial thresholds in the licence text; must be read in full before any use | Skip for now (licence review and runtime cost) |
| Marker, Surya | Complement for OCR and layout | README: "Works on GPU, CPU, or MPS" (Marker) | Python | Model weights under OpenRAIL-M, which carries use restrictions; not reviewed | Document; do not add before 13 Nov |
| PaddleOCR | Complements for scanned invoices in many languages | README badge lists CPU | Python | Large dependency tree; last push 2026-09-16 | Document as production path for scanned intake |
| olmOCR | Complements, but for scanned pages | "it requires a GPU" (README) | Python | GPU-only in practice | Skip (GPU) |
| Unstructured | Overlaps Docling; general ETL | Unverified | Python service | Large general-purpose tree | Skip (overlap) |
| invoice2data | Would be deterministic per-supplier templates, a plausible fit for the supplier master | Unverified | Python | Templates need a maintainer per supplier layout; cannot cover new layouts | Skip. Supplier master already gives verified payee data |
| **Tesseract.js** | Only Node-native OCR found. Complements the text-only intake for image-only pages | Pure JavaScript and WASM (DESC "Pure Javascript OCR"); CPU speed unverified | Native JavaScript | Last push 2026-05-17; Apache-2.0; language data is fetched at run time, so it needs a pinned or vendored copy | **Add before 13 Nov, as a fallback for image-only pages only** |
| Tesseract (C++) | Same as Tesseract.js, native binary | Unverified | CLI | Native install on Windows | Skip (Tesseract.js is simpler from Node) |
| Table Transformer | Would detect tables | Unverified | Python | **Archived** on 2024-06-24 | Skip (archived) |

## B. Structured output and constrained decoding

| Tool | Repo | Licence | Stars | Last push | Archived | Language | What it does | README or description quote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Instructor | [567-labs/instructor](https://github.com/567-labs/instructor) | MIT | 14,110 | 2026-11-11 | no | Python | Typed structured output from LLM calls, through Pydantic | "Get reliable JSON from any LLM. Built on Pydantic for validation, type safety, and IDE support." |
| Outlines | [dottxt-ai/outlines](https://github.com/dottxt-ai/outlines) | Apache-2.0 | 16,008 | 2026-09-21 | no | Python | Constrained generation to a JSON schema, regex or grammar, inside the decoder | "Generate outputs matching JSON schemas" |
| XGrammar | [mlc-ai/xgrammar](https://github.com/mlc-ai/xgrammar) | Apache-2.0 | 2,006 | 2026-11-09 | no | Python (C++ core) | Fast grammar-constrained decoding | "Efficient, Flexible and Portable Structured Generation" |
| Pydantic AI | [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | MIT | 21,161 | 2026-11-12 | no | Python | Typed agents and model calls | "Every model, every interface, typed end to end." |
| Zod | [colinhacks/zod](https://github.com/colinhacks/zod) | MIT | 44,330 | 2026-11-06 | no | TypeScript | Schema validation and JSON Schema generation | "TypeScript-first schema validation with static type inference" |
| Vercel AI SDK | [vercel/ai](https://github.com/vercel/ai) | NOASSERTION (LICENSE: Apache-2.0 text) | 27,884 | 2026-11-12 | no | TypeScript | Provider-agnostic model calls with structured output | "is a provider-agnostic TypeScript toolkit designed to help you build AI-powered applications and agents" |
| BAML | [BoundaryML/baml](https://github.com/BoundaryML/baml) | Apache-2.0 | 9,503 | 2026-11-12 | no | Rust | A language for typed prompts, with generated clients | "The programming language for agents" (description) |
| TypeChat | [microsoft/TypeChat](https://github.com/microsoft/TypeChat) | MIT | 8,693 | 2026-11-12 | no | JavaScript | Natural-language to typed JSON, checked by the TypeScript compiler | "TypeChat is a library that makes it easy to build natural language interfaces using types." |

Judgement:

| Tool | Beat or complement | Windows CPU | Node call | Supply chain and fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| Instructor | Duplicates the current approach (schema plus local validation) in Python | Yes, Python; no hardware need | Sidecar only | No gain over `zod` already used | Skip |
| Outlines, XGrammar | Constrain the decoder. They need logit access, which means a local model, not a hosted API | Local models need a GPU for useful speed; unverified on CPU | Python | Not usable with the hosted providers in ADR 0006 unless a provider exposes that control (not checked in this lane) | Document as the production path only if a local open-weight model is added |
| Pydantic AI | Overlaps the workflow; agent loops conflict with the fixed-order pipeline | Yes | Sidecar only | Would add an agent runtime that chooses steps | Skip |
| **Zod** (already used) | Already the schema source for extraction | Yes | Native | Already a dependency | Keep. Nothing to add |
| Vercel AI SDK | Would replace the hand-written client that ADR 0006 chose on purpose | Yes | Native | Large tree for one HTTP call, which ADR 0006 rejected | Skip |
| BAML | New language and code generator, with its own Rust toolchain | Unverified | Generated TypeScript client | Adds a build step and a new language to review | Skip |
| TypeChat | Same idea as the current schema-plus-check design, with a TypeScript compile step as the check | Yes | Native | Small, MIT, active; but its prompt-and-retry loop is a second model call | Skip (duplicates verify.ts; costs extra calls) |

## C. Prompt and pipeline optimisation

| Tool | Repo | Licence | Stars | Last push | Archived | Language | What it does | README or description quote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DSPy | [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy) | MIT | 39,018 | 2026-11-11 | no | Python | Compiles a program of model calls and tunes its prompts against a metric | "DSPy: The framework for programming—not prompting—language models" |
| TextGrad | [zou-group/textgrad](https://github.com/zou-group/textgrad) | MIT | 3,794 | 2025-07-25 | no | Python | Optimises text variables using model-written feedback | "using large language models to backpropagate textual gradients" |
| promptfoo | [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | MIT | 27,085 | 2026-11-12 | no | TypeScript | Prompt and agent evaluations, red-team plugins and CI reports | "Test your prompts, agents, and RAGs." Also, in the README: "Promptfoo is now part of OpenAI. Promptfoo remains open source and MIT licensed." |

Judgement:

| Tool | Beat or complement | Windows CPU | Node call | Supply chain and fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| DSPy | Could make a cheap model better, by tuning prompts against the labelled set. The repo has no optimiser yet. The cost is many calls: the budget is three calls per invoice (ADR 0006) and free tiers answer bursts with HTTP 429 | Yes, Python | Sidecar; offline only | Optimising on 30 fixtures overfits unless a held-out split and the three gates in doctrine are used. Not before a measured baseline | **Document as production path** (offline optimiser, after a baseline run) |
| TextGrad | Same goal, more calls per step | Yes | Sidecar | Last push 2025-07-25; no recent activity | Skip |
| **promptfoo** | Complements `eval/run.ts`: adds generated injection cases and a CI report. Its own docs say it is part of OpenAI; the licence remains MIT | Yes | Native npm package with a custom JavaScript provider | A new dev dependency with a large tree; needs exact pin and cooling-off (D-012) | **Add before 13 Nov, as a dev-only eval, if the 1-hour test passes** (see shortlist) |

## D. Prompt-injection and guardrails

| Tool | Repo | Licence | Stars | Last push | Archived | Language | What it does | README or description quote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| garak | [NVIDIA/garak](https://github.com/NVIDIA/garak) | Apache-2.0 | 9,997 | 2026-11-06 | no | Python | Scanner for LLM weaknesses, including prompt injection | "`garak` checks if an LLM-backed application can be made to fail in a way we don't want." |
| PyRIT | [microsoft/PyRIT](https://github.com/microsoft/PyRIT) | MIT | 4,797 | 2026-11-12 | no | Python | Red-teaming toolkit with automated multi-turn attacks | "PyRIT (Python Risk Identification Tool for generative AI) is an open-source toolkit" |
| LLM Guard | [protectai/llm-guard](https://github.com/protectai/llm-guard) | MIT | 3,219 | 2026-07-08 | **yes** | Python | Input and output scanners for LLM apps | "This project and its associated models on Hugging Face are no longer under active development or maintained." |
| NeMo Guardrails | [NVIDIA-NeMo/Guardrails](https://github.com/NVIDIA-NeMo/Guardrails) | NOASSERTION (LICENSE.md header: Apache-2.0) | 7,480 | 2026-11-11 | no | Python | Programmable rails for conversational flows | "NeMo Guardrails is an open-source toolkit for easily adding programmable guardrails to LLM-based conversational systems." |
| Rebuff | [protectai/rebuff](https://github.com/protectai/rebuff) | Apache-2.0 | 1,532 | 2024-08-07 | **yes** | TypeScript | Prompt-injection detector | "Rebuff is designed to protect AI applications from prompt injection (PI) attacks through a multi-layered defense" |
| Presidio | [data-privacy-stack/presidio](https://github.com/data-privacy-stack/presidio) | MIT | 11,850 | 2026-11-12 | no | Python | Detects and redacts PII in text and images | "Context aware, pluggable and customizable PII de-identification service for text and images." |

TypeScript equivalents: promptfoo (above) is the only TypeScript tool here with red-team features. Rebuff is TypeScript but archived. No TypeScript port of Presidio or NeMo was found in this lane (not searched exhaustively).

Judgement:

| Tool | Beat or complement | Windows CPU | Node call | Supply chain and fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| garak | Complements the screen. It tests a whole model endpoint with probes; it does not replace the fixed screen in `screen/injection.ts` | Yes (Python) | CLI, run out of band | Adds a Python tool; run against the agent's endpoint, not added to the agent | **Document as production path** (out-of-band red team against the labelled set) |
| PyRIT | As garak, with multi-turn attacks. Microsoft's own repo is active; the `Azure/PyRIT` path is archived | Yes | Python | Larger tree; the attack prompts are model-generated and need a review step | Document |
| LLM Guard | Would overlap the screen | Yes | Python | **Unmaintained** per its README | Skip |
| NeMo Guardrails | Would add an agent-like runtime that changes flow | Yes | Python | Adds a dialogue runtime; the pipeline is not a dialogue | Skip |
| Rebuff | Similar aim to the screen | Yes | TypeScript | **Archived** in 2024 | Skip |
| Presidio | Complements. Redacts personal data before any hosted model call, which R-22 requires for real invoices. It does not decide what a payee is | Yes | HTTP sidecar (Python) | Recognisers may miss South African account or ID formats; not tested | **Document as production path** (redaction before any real invoice reaches a model) |

## E. Fraud, duplicate and entity matching

| Tool | Repo | Licence | Stars | Last push | Archived | Language | What it does | README or description quote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Splink | [moj-analytical-services/splink](https://github.com/moj-analytical-services/splink) | MIT | 2,576 | 2026-11-11 | no | Python | Probabilistic record linkage on SQL backends | "Fast, accurate and scalable probabilistic data linkage with support for multiple SQL backends" |
| recordlinkage | [J535D165/recordlinkage](https://github.com/J535D165/recordlinkage) | BSD-3-Clause | 1,067 | 2024-02-21 | no | Python | Record linkage and duplicate detection toolkit | "A powerful and modular toolkit for record linkage and duplicate detection in Python" |
| dedupe | [dedupeio/dedupe](https://github.com/dedupeio/dedupe) | MIT | 4,528 | 2025-07-29 | no | Python | Fuzzy matching and deduplication with active learning | "A python library for accurate and scalable fuzzy matching, record deduplication and entity-resolution." |

Invoice anomaly detection: the search found no tool with an open licence that is maintained and tested on invoices. Search results are in the next section.

Judgement:

| Tool | Beat or complement | Windows CPU | Node call | Supply chain and fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| Splink | Probabilistic linkage answers "is this probably the same supplier", which can only be a hint. R-7 says payee accounts come only from verified supplier records, so a probability cannot authorise a payment | Yes | Sidecar | Overkill for a supplier master of a few records | Skip (for the payment path). Revisit only if the supplier master grows |
| recordlinkage | Same as Splink | Yes | Sidecar | Last push 2024-02-21 | Skip |
| dedupe | Same as Splink; needs human labelling of pairs | Yes | Sidecar | Last push 2025-07-29 | Skip |

Note: duplicate control in SignOff is deterministic (the duplicate lock in ENGINEERING.md), and that stays deterministic.

## F. Orchestration, memory and tracing

| Tool | Repo | Licence | Stars | Last push | Archived | Language | What it does | README or description quote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LangGraph JS | [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) | MIT | 3,414 | 2026-11-11 | no | TypeScript | Graph runtime for stateful agents | "Framework to build resilient language agents as graphs." |
| Mem0 | [mem0ai/mem0](https://github.com/mem0ai/mem0) | Apache-2.0 | 68,852 | 2026-11-06 | no | Python | Memory layer for agents | "The Memory Layer for AI Agents" |
| Letta | [letta-ai/letta](https://github.com/letta-ai/letta) | Apache-2.0 | 25,422 | 2026-10-18 | no | Python (API reports no primary language) | Stateful agent platform with memory | "Build stateful agents with memory that can learn and improve over time." |
| Langfuse | [langfuse/langfuse](https://github.com/langfuse/langfuse) | NOASSERTION (README badge MIT; LICENSE: some folders under a separate licence) | 37,349 | 2026-11-12 | no | TypeScript | Tracing, evals and prompt management on OpenTelemetry | "Langfuse is an open source AI engineering platform for agent evals and observability." (bold removed) |
| OpenTelemetry GenAI conventions | [open-telemetry/semantic-conventions](https://github.com/open-telemetry/semantic-conventions) | Apache-2.0 | 686 | 2026-11-10 | no | Jinja (spec) | Standard attribute names for model and agent telemetry | "Defines standards for generating consistent, accessible telemetry across a variety of domains" |

Judgement:

| Tool | Beat or complement | Windows CPU | Node call | Supply chain and fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| LangGraph JS | Would make the flow a runtime that can decide the next step. The repo's pipeline says the model "never chooses a step" | Yes | Native | Adds a runtime, against the design | Skip |
| Mem0, Letta | Memory across invoices adds state that an attacker can write to. R-13 says external content is hostile | Yes | Python service | Adds a store and a new data-retention question | Skip |
| Langfuse | Would add a database and a web service to the demo. The repo already writes a transition log with hashes | Self-hosting needs a database and Docker (unverified on Windows) | HTTP or OpenTelemetry SDK | Licence file says portions are licensed separately; the split was not read in full | Document as production path |
| OpenTelemetry GenAI conventions | Gives the transition log standard attribute names. A spec, not a dependency | n/a | Use names only | No dependency needed | **Document**: name the transition-log fields after the standard |

## G. Agent frameworks, skills, datasets and finance benchmarks

GitHub topic and keyword searches, read 12 November 2026:

- `invoice extraction`: several projects, but most have no licence (for example `Jayasri-Shanmathi/InvoiceExtraction`, 52 stars, last push 2026-04-18, no licence) or are small (`fvmuzik00/ap-automation-agent`, 11 stars, description "Autonomous AP agent + DOCX standardization. GPT-4o invoice extraction, three-way matching, approvals, ERP sync", no licence). A project with no licence cannot be copied into an MIT repository.
- `ap-automation` topic: `mshojaei77/invoice-to-pay-agent` (MIT, 9 stars, last push 2026-06-29; description "Open-source invoice-to-pay agent for AP automation: OCR/VLM extraction, 3-way matching, approvals, fraud checks, ERP mock posting, evals, and audit logs."). It is the closest match in the search and is a reference only. Its star count is small, and its evals were not reviewed.
- `document-ai` topic: `Zipstack/unstract` (AGPL-3.0, 7,442 stars, last push 2026-11-12). AGPL is incompatible with this MIT repository for code it distributes. `clovaai/donut` (MIT, 6,927 stars, last push 2024-07-11) is an OCR-free research model and is not a production candidate.
- `llm-agents-finance` topic: no results.
- `finance agent benchmark`: `SecondState-ai/finance-agents-benchmark` (MIT, 5 stars, last push 2026-10-12; "FAB: a benchmark for AI agents doing financial due diligence."), and `benstaf/ipoagent` (MIT, 8 stars, last push 2026-07-03; "IPO Finance Agent: Benchmarking LLM Financial Analysts Beyond Finance Agent v2"). A third-party repository claims a score on the Vals AI Finance Agent Benchmark. That claim was not verified and is not used.
- Invoice datasets: `FelixHertlein/inv3d-model` and `inv3d-generator` (MIT, 63 and 26 stars, last push 2024), from "Inv3D: a high-resolution 3D invoice dataset for template-guided single-image document unwarping". These are 3D images, not text invoices. `FuxiJia/InvoiceDatasets` (32 stars, 2018) has no licence.

Judgement:

| Item | Beat or complement | Verdict |
| --- | --- | --- |
| `mshojaei77/invoice-to-pay-agent` | Reference architecture with evals, same problem | Read for ideas; do not copy code (not reviewed for licence headers beyond the MIT badge) |
| Inv3D | Would help only scanned, curved photographs | Skip for now |
| FAB, ipoagent | Financial research tasks, not invoice payment | Skip for SignOff; note as a possible benchmark for finance reasoning only |
| Any dataset with no licence | Cannot be used | Skip |

## Ranked shortlist

### Add before 13 Nov (at most three)

1. **Tesseract.js, fallback for image-only pages only.**
   - *Integration point:* `apps/agent/src/intake/pdf-text.ts`. When a page has no text layer, run OCR on it, pass the output through `normaliseKeepingLines` in `apps/agent/src/text/normalise.ts`, and keep the page marked as OCR in the transition log.
   - *1-hour test:* render three invoice pages from the labelled fixtures to PNG, run OCR, and record the character error rate against the known fixture text in the test log. Also record run time on the Windows laptop. Report it as measured or unverified; no accuracy claim without that.
   - *Conditions:* exact version pin, published at least seven days before adoption (D-012), a journal entry (reason: no Node-native OCR without Python), and the language data vendored or pinned.
2. **promptfoo, dev-only evaluation.**
   - *Integration point:* a new `apps/agent/eval/promptfoo/` config whose custom provider calls `extractInvoice` (`apps/agent/src/extract/extract.ts`) with the simulated model, run over the 30 labelled fixtures and the injection cases.
   - *1-hour test:* run the config and compare its verdicts with `apps/agent/src/eval/run.ts` on the same cases. If the two disagree, record why before using either.
   - *Conditions:* dev dependency only, exact pin, D-012 cooling-off, journal entry. Note its ownership: promptfoo's README says it is "now part of OpenAI".
Only two items qualify. Presidio and Docling are the next candidates, but both need a Python sidecar and a test that a Windows laptop can run in an hour, so they are listed under production path below.

### Document as production path

- **Docling / Docling Serve** for table-heavy text PDFs. Test before adoption: the quote check must still find each quoted value in the new text order.
- **PaddleOCR** for scanned intake in more languages, where CPU speed is acceptable. Measure first.
- **Presidio** (sidecar) to redact personal data before any real invoice reaches a hosted model (R-22). Test its recognisers on South African account and ID formats first.
- **garak** and **PyRIT** as an out-of-band red team against the agent's model endpoint, using the labelled injection set as a starting point.
- **DSPy** as an offline optimiser, only after a baseline run and a held-out split, with the three gates before any "A beats B" claim.
- **Langfuse** (self-hosted) or the **OpenTelemetry GenAI conventions**. Start by naming the transition-log fields after the standard, which needs no dependency.
- **Outlines / XGrammar**, only if a local open-weight model is added and measured.

### Skip, with reason

| Tool | Reason |
| --- | --- |
| Instructor, Pydantic AI | Python; the repo's Zod schema and local verification already do the job |
| Vercel AI SDK, BAML, TypeChat | Duplicate the chosen client or validation design; ADR 0006 rejects an SDK for one HTTP call |
| LangGraph JS | Would let a runtime choose steps, against the fixed pipeline |
| Mem0, Letta | Memory is a write path for hostile content (R-13) |
| LLM Guard, Rebuff, Table Transformer | Archived or unmaintained (API `archived: true`; LLM Guard README) |
| TextGrad | Last push 2025-07-25; more calls per step |
| NeMo Guardrails | Adds a dialogue runtime the pipeline does not need |
| Splink, recordlinkage, dedupe | Probabilistic matches cannot authorise a payment (R-7) |
| MinerU | Commercial thresholds in its licence text; GPU-oriented in practice (unverified) |
| olmOCR | Requires a GPU (README) |
| Unstructured, Marker, Surya | Overlap Docling and PaddleOCR; model weights under OpenRAIL-M |
| invoice2data | Per-supplier templates break on new layouts; the supplier master is the verified source |
| Any unlicensed or AGPL project found in search | Cannot be copied into an MIT repository |

## What could not be verified

- Speed, accuracy and cost of every tool on the Windows CPU laptop and on the free providers. No run was made.
- Whether any hosted provider in ADR 0006 exposes grammar or logit constraints (Outlines and XGrammar depend on it).
- Presidio's coverage of South African account and ID formats.
- Licence terms of model weights (Marker, Surya, MinerU). Only the code licences and badges were read.
- Whether the repository's current `origin/feat/console-redesign` code matches what this document describes beyond the files named.
- Completeness of GitHub search: topic and keyword searches are limited and are not a survey.
- The Vals AI finance benchmark score claimed by a third-party repository.
- The language value the API reports for Unstructured (`HTML`); it was not checked.
