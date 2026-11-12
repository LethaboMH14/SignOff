# Research review and plan (R1 to R6, PRs #68 to #73)

Status: review note, docs only, 12 November 2026. Deadline: 13 November 2026, 23:59 SAST. Nothing here changes code. The six research files are not rewritten; this note grades them and turns them into one plan.

## Limitations first

- **I did not read the cited pages myself.** Three verifier subagents re-fetched the URLs (WebFetch, with search as a fallback) and reported verdicts and quoted spans. Their report text is the evidence; I did not open the pages. Their results files were not written (the agents had no write tool), so the table below is the only copy.
- **Sampling.** About 8 claims per file were checked (R6: 7). That is a sample of load-bearing claims, not a clean bill for the rest of each file.
- **Verdict words.** CONFIRMED means a literal span was found. CONTRADICTED means the page says otherwise, or the claim is an overclaim of what the page says. UNCONFIRMED means the page loaded but the quoted span is absent, so the claim is neither supported nor disproved and must not be used. UNREACHABLE means the page did not load.
- **Code checks** used `git show` and `git grep` on `origin/feat/console-redesign` (head `18787d4`), `origin/feat/integrate-gate-c` and `origin/main` (head `7f77407`), read today. I did not run any test, the attack suite or the console. I did not read the whole code base; mismatches below are only the ones I found.
- **Branch state:** `origin/main` is 11 commits ahead of and 93 commits behind `origin/feat/console-redesign`. `origin/feat/integrate-gate-c` is not an ancestor of the console branch (it has 5 commits the console branch lacks). The console, Warden attack suite, FX and calendar code sit on different unmerged branches. Whether they merge cleanly is **unverified**.

## 1. Verification table

| File | Claim (short) | Verdict | Evidence or reason |
|---|---|---|---|
| R1 | Full tax invoice above R5 000 (SARS) | CONFIRMED | "full tax invoice when the price is more than R5 000" |
| R1 | Abridged invoice at R5 000 or less | CONFIRMED | "abridged tax invoice when the consideration for the supply is R 5 000 or less" |
| R1 | R50 or less needs no tax invoice | CONFIRMED | "R50 or less, a tax invoice is not required." |
| R1 | OWASP: file signature check not enough alone | CONFIRMED | "This should not be used on its own" (fetch returned fragments) |
| R1 | OWASP: run uploads through antivirus or sandbox | CONFIRMED | "Run the file through an antivirus or a sandbox" |
| R1 | DMARC needs From alignment (RFC 7489) | CONFIRMED | "requiring that it match (be aligned with) an Authenticated Identifier" |
| R1 | DKIM proves only unchanged content (RFC 6376) | CONFIRMED | "asserts that the hashed content has not changed since it was signed" |
| R1 | IGC Zambia e-invoicing study, 61 firms | CONFIRMED | "Based on interviews with 61 firms." The doc's "all Zambian firms since 2024" was not separately checked |
| R2 | Textract tables $0.015 per page | CONFIRMED | "one million pages with tables is $0.015" |
| R2 | Textract AnalyzeExpense free tier 100 pages | CONFIRMED | "Analyze Expense API: 100 pages per month" |
| R2 | Gemini 3.5 Flash $1.50 in / $9.00 out, and the $0.0114 per call and $11.40 per 1 000 invoices built on it | CONTRADICTED | Current page has no 3.5 Flash row; 3.5 Flash-Lite and 3.8 Flash rows only. The derived costs are unsupported |
| R2 | Groq gpt-oss-120b $0.15 / $0.60 per 1M (third-party page) | CONFIRMED | "$0.15 per million input tokens and $0.60 per million output tokens." (R5 confirmed the same on Groq's own table) |
| R2 | OWASP LLM01 sentence marked [V] (verbatim) | CONTRADICTED | Sentence is on neither OWASP page checked. The [V] mark is wrong |
| R2 | Google date normaliser defaults to mm/dd/yyyy | CONFIRMED (wording differs) | "it will use mm/dd/yyyy format"; R2's quoted sentence is not verbatim |
| R2 | Google Invoice parser "$0.10 per 1 count" | UNREACHABLE | Page returned only its title |
| R2 | PaddleOCR-VL 0.115 vs Docling 0.749 (arXiv 2510.14528) | UNREACHABLE | File over the 10 MB fetch limit |
| R3 | AFP: BEC cited by 63% of respondents | CONFIRMED | "cited by 63% of respondents" |
| R3 | IC3 PSA "The $50 Billion Scam" | CONFIRMED | Title found |
| R3 | IC3 BEC $3,046,598,558 and 24,768 complaints | UNCONFIRMED | Secondary page gives only "$3.046 billion" |
| R3 | Corpay: payment stops unless PO, receipt, invoice agree | CONTRADICTED (quote not literal) | Page: "only releases payment when they agree within tolerance." Same idea, different words |
| R3 | SAP KBA 3749979: dual control only on fields you designate | CONTRADICTED | Page is login-gated; it says the process applies "only to changes to existing vendor bank details" |
| R3 | PACRA terms prohibit bulk scraping | CONTRADICTED (overclaim) | Source: "The PACRA terms were not read for this guide." and "Bulk automated scraping has been reported as restricted." |
| R3 | OFAC SLS main channels are UI and API | UNCONFIRMED | Only "The SLS API allows users to automate their data pulls." |
| R3 | MINJA memory-poisoning paper (arXiv PDF) | UNREACHABLE | Binary response |
| R4 | Signer list holds 1 to 32 addresses | CONFIRMED | "1 to 32 addresses"; quorum wording and the "last signing method" quote are absent |
| R4 | Multi-sign fee is (N+1) times normal | CONFIRMED | "(N+1) times the normal transaction cost" |
| R4 | asfDisableMaster and master-key signing rule | CONFIRMED | Flag value 4 and rule found |
| R4 | Testnet RLUSD issuer rQhWct2f... | CONFIRMED | Found on fetched page |
| R4 | Testnet tokens have no financial value | CONFIRMED | "no financial value" |
| R4 | Clawback "if, and only if" | CONFIRMED | Quote found |
| R4 | Partial payments: check `delivered_amount` | CONFIRMED | Found |
| R4 | A ticket account cannot hold more than 250 tickets | CONFIRMED | "cannot have more than 250 Tickets" |
| R4 | SA exchange-control draft: companies cannot use the cross-border crypto route | UNREACHABLE | Polity returned 403. Secondary snippets say individuals; daily versus monthly R5 000 / R25 000 limits are inconsistent. Counsel must read the draft |
| R4 | Multi-sign reserve 0.2 XRP versus 5 XRP | UNREACHABLE | Not on the fetched page; R4 already marks it UNVERIFIED |
| R5 | Groq gpt-oss-120b $0.15 / $0.60 | CONFIRMED | "$0.15 input$0.60 output" |
| R5 | Groq strict mode uses constrained decoding, 120b listed | CONFIRMED | "uses constrained decoding to guarantee..." |
| R5 | Gemini 3.8 Flash $0.75 through 31 Dec 2026; 3.5 Flash not priced | CONFIRMED | "$0.75 through December 31, 2026." Last 9.5k chars of the page unread |
| R5 | "The Attacker Moves Second": 12 defenses bypassed, over 90% ASR | CONFIRMED | "we bypass 12 recent defenses"; "attack success rate above 90% for most" |
| R5 | CaMeL solves 77% of tasks vs 84% undefended | CONFIRMED | "77% of tasks ... (compared to 84%..." |
| R5 | Anthropic multi-agent system uses about 15x more tokens | CONFIRMED | "about 15× more tokens than chats" |
| R5 | Google scaling study, -70.0% to +80.8% over 260 configurations | CONFIRMED | "+80.8% ... to -70.0%" |
| R5 | MAST: 14 failure modes in 3 categories | CONFIRMED | "14 unique modes, clustered into 3 categories" |
| R6 | XRPL: LastLedgerSequence makes a transaction final or failed by a ledger | CONFIRMED | Sentence found on the official page |
| R6 | Frankfurter 219 currencies, 111 central banks | CONFIRMED | Figures hold. The quotes "39 other assets" and "Rates update throughout the day" are not on the page |
| R6 | Ramp approval workflow builder | CONFIRMED | "approval workflow builder" |
| R6 | Secret Manager: data-access logs; least privilege | CONFIRMED | Both verbatim |
| R6 | OWASP API2:2023 Broken Authentication | CONFIRMED | "API2:2023 - Broken Authentication" |
| R6 | Bill.com: an Administrator can pay regardless of approval policy | CONFIRMED (wording differs) | Page says an organization user with the Administrator role |
| R6 | Stripe Issuing: with no controls and no webhook, Stripe approves | UNCONFIRMED | Real-time-authorizations page says "automatically approved or declined based on your timeout settings". Sentence may be on the spending-controls page, not fetched. R6 design lesson 3 rests on it |
| R6 | Stripe 2-second authorization timeout | CONFIRMED | Found on the same page |

**Totals reported by the verifiers:** R1 8 of 8 confirmed. R2 5 confirmed, 2 contradicted, 2 unreachable (plus 1 wording drift). R3 2 confirmed, 3 contradicted, 2 unconfirmed, 1 unreachable. R4 8 confirmed, 2 unreachable. R5 8 of 8 confirmed. R6 6 confirmed (2 with wording drift), 1 unconfirmed.

**Reading of the table.** The numbers and facts that decide design (SARS thresholds, XRPL multi-sign and ticket facts, price per token for Groq, prompt-injection and multi-agent papers) held up. The weak spots are R3's vendor and fraud-statistic quotes, R2's Gemini price and its [V] mark, and R4's South African exchange-control claim. None of the weak spots feeds code; they feed prose and the business case, so they must not reach the README or video.

## 2. Mismatches against the code and conflicts between files

### 2a. Doc versus code (checked today)

| # | Doc says | Code or record says | Verdict |
|---|---|---|---|
| M1 | R1: intake calls `extract` on every poll before the seen check (`intake.ts:138` before `:140`) | `intake.ts:98` calls `extract`; `:138` awaits `intakeFile`, `:140` checks `seen` | **Matches.** Real efficiency and stall gap |
| M2 | R1: scans held as `NO_TEXT_LAYER` | `intake.ts:30, 104` | Matches |
| M3 | R4: console branch still says RLUSD BLOCKED | `ENGINEERING.md:3` and `:47`, `ISSUES.md:32` and `:42`, and TEST-LOG T-059, T-061, T-106 on the console branch all say BLOCKED or "no RLUSD payment has run". `main` TEST-LOG T-059 says PASS (1 RLUSD, ledger 22255596, hash 3CCC034B...). The branch README line 97 already says 1 RLUSD validated, so the branch contradicts itself | **Matches, and worse than R4 says** (T-061 and T-106 also stale) |
| M4 | R3: cooling-off and maker-checker "not implemented" | `apps/warden/src/service.ts:764` sets `coolingOffUntil`; `service.ts:1055` onward moves ended changes into effect; console views show it. R6 (which read `service.ts:764`) is right | **R3 is wrong on cooling-off.** Maker-checker for limit increases: PR #53 added a deny-until-approved rule; self-approval rejection not verified by anyone |
| M5 | R3: agent has zero receipt tolerance, Warden has tolerance | `match.ts` flags `AMOUNT_EXCEEDS_RECEIPT` when `invoice.amountMinor > receipt.receivedMinor`; Warden `config.ts` has `matchTolerance` | **Matches.** Unreconciled rule |
| M6 | R5: simulated figure "95.2% / 41.9%" | No file on the console branch contains 95.2 or 41.9. `simulated-eval.md` says 100.0% pipeline versus 56.7% baseline, simulated | **The figure has no source in the tree.** Do not cite it. Where it came from is unknown |
| M7 | R2: live runs failed 20 to 22 of 30 calls | Result files `live-groq`, `live-gemini`, `live-openrouter` exist on the console branch; I did not recount them | Not rechecked. Treat as stated, and still open (no later rerun found) |
| M8 | R2 and R5: schema has no line items or tax; `complete()` returns `null` on any error | Not rechecked beyond R5's reading of the same files | Unverified by me |
| M9 | R6: FX module and calendar on `integrate-gate-c`, attack suite on `gate-b-warden-controls`, none on the console branch | Confirmed by `git ls-tree`: `docs/FX-AND-CALENDAR.md` and calendar code only on `integrate-gate-c`; `docs/ATTACK-SUITE.md` and `scripts/attack-suite.ts` only on the gate-b and gate-c branches | **Matches.** The demo stack is fragmented; none of it is on `main` |
| M10 | R6: console holds are shown on fixtures | PR #66 title: "changed-payout hold, operator limits and receipt views (fixtures)" | Matches. Console holds are not driven by a live Warden |
| M11 | R1 gap 3: "no invoice-number dedupe" versus R3: duplicates caught by obligation key | I did not find where the obligation key is built | **Unresolved.** One of the two is wrong; check before claiming duplicate protection |
| M12 | R6: no hash chain on the transition log | `git grep prevHash` on the console branch: no hits | Matches |
| M13 | R5: `BUILD-BRIEF` says Claude Haiku and LangGraph.js | `BUILD-BRIEF.md:35` says exactly that | Matches (see C1) |

### 2b. Conflicts between files and documents

| # | Conflict | Resolution proposed |
|---|---|---|
| C1 | **Model vendor.** `BUILD-BRIEF.md:35` names Claude Haiku and LangGraph.js. ADR 0006 (`docs/decisions/0006-model-boundary-and-providers.md` lines 10, 19, 32) records the owner's 2026-11-10 instruction: no Claude models, Anthropic refused in code (`providers.ts` `assertModelAllowed`). `AGENTS.md` says "the current build brief takes precedence", which would make the brief win. R2 and R5 both flag this and decline to resolve it | The project policy and the code follow ADR 0006. Correct `BUILD-BRIEF.md:35` (and note in `AGENTS.md`) so the brief matches the ADR. Owner confirms in one line. R5 is right not to recommend or price Claude models |
| C2 | **LangGraph.** Brief names LangGraph.js; code is a fixed hand-written pipeline (`states.ts`); R5 recommends keeping it. `git grep langgraph` on the console branch finds nothing in code or `package.json` | Say "fixed state machine", not "LangGraph", in the README and video. Fix the brief line |
| C3 | **Model prices.** R2 prices Gemini 3.5 Flash at $1.50 / $9.00; R5 says no official page prices that model; the verifier found no 3.5 Flash row | R5 is right. Delete R2's per-invoice cost figures until a price is read from an official page |
| C4 | **RLUSD status.** R4 and R6 both say the 1 RLUSD run passed (main T-059, commit `147050b`); the console branch docs say BLOCKED | Console branch must pick up `main`; see M3 |
| C5 | **Scanned PDFs.** R1 says scans are held and OCR is out of scope; R2 says keep "scanned PDFs held" and puts OCR under LATER | **No conflict** in the sections read. Both agree: hold scans, claim no OCR. The real coupling is different: R2 found that the model call fails on most fixtures, so even text PDFs mostly end in a hold |
| C6 | **Cooling-off.** R3 says not implemented; R6 and the code say it exists, hours-based | R3 wrong (M4). R6 correctly recommends business days via the calendar module, which sits on a different branch |
| C7 | **Duplicate detection.** R1 gap 3 versus R3 (M11) | Unresolved; plan item P7 |
| C8 | **Receipt tolerance.** Agent zero, Warden non-zero (M5) | Pick one; plan item P8 |
| C9 | **Who proves what.** R6 table row 1 says the trigger from invoice intake to Testnet payment is unverified; R4 says live pause (T-124) and Warden unit tests exist but were not rerun; the branch README row 95 says "Not yet: no end-to-end run" (T-087) | Consistent. The agent-to-Warden-to-Testnet run is the biggest unproven link (plan P4) |

## 3. Consolidated MUST-FOR-DEMO list for 13 November

Sizes: S under 1 hour, M 1 to 3 hours, L over 3 hours. Ordered by what blocks everything else, then by risk to the demo. "Build today" items are actions. "Document as a limitation" items are listed in section 4.

### Build today

| # | Item | Size | Touches | Acceptance check |
|---|---|---|---|---|
| P1 | **Get one runnable branch.** Merge the stack (console, gate-b, gate-c, FX and calendar, S3 watchdog, A3 proof from `main`) into a single demo branch and then `main`. Open stacked PRs: #55 to #58 | L | Branches `feat/console-redesign`, `feat/integrate-gate-c`, `feat/gate-b-warden-controls`, `main` | Fresh clone of one branch: `npm ci`, `npm test`, the attack suite, and the console start, all green; `git ls-tree` shows `ATTACK-SUITE.md`, `FX-AND-CALENDAR.md`, TEST-LOG T-059 PASS on that branch |
| P2 | **Fix the stale BLOCKED docs** (follows P1, which brings in `main`'s T-059): `docs/ENGINEERING.md:3,47`, `docs/ISSUES.md:32,42`, TEST-LOG T-061 and T-106. State "1 RLUSD validated; 10 RLUSD run open" | S | `docs/ENGINEERING.md`, `docs/ISSUES.md`, `docs/logs/TEST-LOG.md` | `git grep -n -i blocked -- docs` shows no RLUSD line that contradicts T-059; the README, ENGINEERING and TEST-LOG all state 1 RLUSD |
| P3 | **Settle the vendor conflict in text.** Edit `BUILD-BRIEF.md:35` to match ADR 0006 (no Claude; fixed pipeline, not LangGraph); one line in `AGENTS.md` on precedence | S | `BUILD-BRIEF.md`, `AGENTS.md` | `git grep -n -i -E "claude|langgraph" BUILD-BRIEF.md README.md` returns only lines marked historical or refused |
| P4 | **End-to-end run on Testnet:** invoice file dropped in the inbox, agent extracts and matches, running Warden checks and co-signs, 1 RLUSD paid, console shows the explorer link. Record as TEST-LOG T-087 with the hash and the invoice file hash. Use a labelled live model only if P5 succeeds; otherwise run the model step in the labelled simulated mode and say so | L | `apps/agent`, `apps/warden`, `packages/xrpl`, `scripts/testnet`, `docs/logs/TEST-LOG.md` | TEST-LOG row PASS with ledger hash readable from `tx`, two signers, delivered 1 RLUSD, and the run's mode (LIVE model or SIMULATED model) written in the row |
| P5 | **Isolate MODEL_CALL_FAILED.** Make `extract.ts complete()` keep HTTP status, error class (timeout, refusal, cut-off, bad JSON) and finish reason. Rerun the 30-case set on one provider. Report counts of replies and of failures separately | M | `apps/agent/src/extract/extract.ts`, `apps/agent/src/model/chat-client.ts`, `apps/agent/results/live-*` | New `live-eval.md` lists failures by class; either at least 25 of 30 calls return a reply, or the report says exactly why not. No accuracy claim either way until it does |
| P6 | **Single-key rejection on RLUSD.** T-054 was on TST only; the brief's acceptance names both single keys | S | `scripts/testnet`, `docs/logs/TEST-LOG.md` | Two logged `tefBAD_QUORUM` refusals on an RLUSD payment (Agent alone, Warden alone) |
| P7 | **Duplicate by invoice number: resolve R1 versus R3.** Find where the obligation key is built; add a test that a re-saved PDF with the same supplier and invoice number but different bytes is held | S to M | `apps/agent/src/match/match.ts`, `apps/warden/src/service.ts`, tests | Test passes; the README duplicate claim is worded to what the test shows |
| P8 | **Align receipt tolerance** between agent (`match.ts`, zero) and Warden (`checks.ts`, configured). Choose one rule, test a receipt short by less than the tolerance | S | `apps/agent/src/match/match.ts`, `apps/warden/src/checks.ts` | One test per side; the same input gives the same verdict in both |
| P9 | **Demo holds live on the console, not fixtures:** changed payee (`PAYEE_CHANGED`), lowered limit (`OVER_LIMIT`), missing receipt, and the limit-increase self-approval check. Use the live Warden, not the PR #66 fixtures | M | `apps/console`, `apps/warden/src/service.ts` | Each hold shown in the console with its reason code and "nothing submitted"; self-approval of a limit increase is rejected in a test |
| P10 | **Intake re-parse fix.** Check `seen` by cheap key (name, size, mtime) before calling `extract` | S | `apps/agent/src/intake/intake.ts:138-143` | New test: second poll of an unchanged file makes zero `extract` calls |
| P11 | **Label pass.** Every simulated element (identity check, ZAR payout, FX fallback, attack-suite ledger, simulated eval) is labelled in the README, console and receipt; the FX fixture cannot influence a control decision | S | `README.md`, console views, `apps/warden/src/identity.ts`, FX `rates.ts` | A reviewer can find the word SIMULATED next to each of the five |
| P12 | **Run one Warden instance and record the backup.** Record the three-step demo on one build with the commit hash on screen, plus the attack-suite table (`npm run attack`) labelled in-memory. Do not depend on the faucet | S | demo environment | Backup file exists and the commit hash on screen equals the demo branch head |

**If time runs short, cut in this order:** P10, P8, P7 become limitations (section 4); P6 and P9 shrink to one case each; never cut P1, P2, P3, P4, P11.

## 4. Document as a limitation (do not build before the deadline)

- Scans, photos, HEIC, Word, Excel, XML, email intake: held, no OCR (R1, R2).
- Line items, tax and arithmetic re-add: only the printed total is read (R2). Do not claim VAT or line-item checks.
- Injection screen is English-only regex; no malware scan beyond the child process (R1).
- Multi-invoice PDFs, credit notes, foreign currency: not classified (R1).
- Supplier identity and bank-account verification: simulated allow-list, no live AVS, CIPC, PACRA or sanctions checks (R3).
- Near-duplicate and split-invoice detection: not built (R3).
- ZAR payout to a bank: simulated at a placeholder rate (R4, branch README row 102).
- The 10 RLUSD run is still open; only 1 RLUSD is proven.
- Warden key storage is a plaintext seed file; no KMS or HSM; one Warden process; the pause route shares the Warden operator surface (R4, R6).
- Transition log has no hash chain; export is unsigned (R6).
- Operator sign-in is a scrypt password file; no MFA or SSO; not deployed beyond local loopback (R6).
- Cooling-off is hours, not business days (R6).
- Multi-replica safety, tickets, ledger-gap check, delegation: not built (R4).
- Swarm versus single-prompt: no measured benefit; do not claim one (R5).
- Counsel review: SA exchange control, Zambia registration, travel rule (R4). Nothing in the research is legal advice.

## 5. What the README and the video may claim

| Claim | Label | Basis |
|---|---|---|
| A two-signature payment of 1 RLUSD (Agent plus Warden) validated on XRPL Testnet, ledger 22255596, from the expected issuer | **REAL** | `main` TEST-LOG T-059, hash 3CCC034B...; Testnet only, no value |
| The Agent key alone and the Warden key alone are refused with `tefBAD_QUORUM` | **REAL on the test-issued token (TST)**; UNVERIFIED on RLUSD until P6 | T-054 |
| Account is set up with two signers, quorum 2, master key disabled | **REAL** | T-052, T-058 |
| Warden refuses and holds duplicates, payee changes, limits, pause (with a test-issued token) | **REAL on Testnet with TST, not RLUSD**, per branch README row 99; verify wording after P1 | TEST-LOG; I did not rerun |
| Thirteen attack scenarios (ATK-01 to ATK-13, PIN-01 to PIN-05) behave as designed | **SIMULATED** (in-memory ledger, simulated identity) | `docs/ATTACK-SUITE.md` |
| Labelled-set decision accuracy 100% (30 of 30) for the pipeline | **SIMULATED** (rule-based stand-in); never quote it as model accuracy | `results/simulated-eval.md` |
| Six injected invoices quarantined before any model call | **REAL on fictional data**, one run | `live-eval.md` (R2) |
| "0 false approvals" in live runs | **UNVERIFIED as a safety result**: it came from holding almost every invoice | R2, T-094 |
| Rand figure and payout to a supplier's bank | **SIMULATED** | D4, README row 102 |
| Supplier identity or account verification | **SIMULATED** allow-list | `identity.ts` |
| The agent runs from an invoice file to a Testnet payment with no approval click | **UNVERIFIED** until P4 passes | R6, README row 95 |
| Model reads invoices accurately | **UNVERIFIED** (20 to 22 of 30 live calls failed) until P5 | R2 |
| Multi-agent swarm beats a single prompt | **UNVERIFIED**; do not claim | R5 |
| Cost per invoice, any pricing figure | **UNVERIFIED**; the Gemini 3.5 Flash price is contradicted | R2, R5 |
| BEC loss and fraud statistics (AFP 63%, IC3 "$3.046 billion") | May be cited with their source, as secondary figures. Exact IC3 figures and ACFE figures are not confirmed | R3 table rows |
| SARS thresholds R50, R5 000 | May be cited | R1 table rows |
| Operator can explain a hold, lower a limit, find a receipt, on phone and desktop | **UNVERIFIED** (no timed walkthrough) | R6 |
| Validated with customers | **UNVERIFIED**; none recorded | R6 |
| Zambian ZRA Smart Invoice format support | **UNVERIFIED** (page never read) | R1 limitations |
| Works in South Africa for companies sending crypto cross-border | **UNVERIFIED** and probably not allowed; needs counsel | R4 row, secondary only |
| Uses Claude or LangGraph | **Do not claim**; the project refuses Claude and the code is a fixed pipeline | ADR 0006, `states.ts` |

## 6. What I could not verify

- The page text behind every verdict above: I relied on the verifier agents' reports.
- Any statement I did not sample (roughly 80 percent of the claims in the six files).
- Whether the stacked branches merge cleanly, and whether the tests and the attack suite pass at any head.
- R2's live-run counts (M7) and schema claims (M8): not recounted.
- Where the obligation key is built (M11) and whether limit-increase self-approval is rejected.
- R6's claims about CSRF coverage, CI contents and `npm audit` results (R6 itself marks them unread).
- Whether the Zambian, South African and Peppol items in R1 are current; the ZRA page was never read by R1 or by me.
- The PACRA, SAP, OFAC and Stripe sources named in R3 and R6, beyond what the verifiers found.
