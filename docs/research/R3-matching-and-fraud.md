# R3: Matching and fraud decisions

Status: research note, docs only. Date of research: 12 November 2026. Scope: STEP 3 of the research lanes, the matching and fraud decisions that sit between extraction and the Warden's signature.

**Evidence labels used below.** Every factual claim carries a source URL and a quoted span. The quoted spans are **search-result excerpts** returned by WebSearch. I did not open the full pages in this session, so a quote is only as good as the excerpt. Items marked **UNVERIFIED** could not be confirmed against the primary source. Items marked **MY ARITHMETIC** are my calculations, not a source's. Items marked **SIMULATED** describe what the demo does, not what the real world does.

## Limitations, stated first

1. Search excerpts, not full pages. Quotes come from search snippets. Primary documents (the AFP report, the FBI IC3 report, the ACFE report, the ERP help pages) were not read in full.
2. Several headline figures disagree between secondary sources (see sections 1 and 4). I report the spread instead of picking one.
3. The ACFE 2026 fictitious-vendor and billing statistics were not found in a primary source.
4. Fraud-dataset licences (section 4) were not researched beyond the invoice datasets.
5. Sage Business Cloud and SAP Ariba were not covered by any usable result.
6. I read the Warden and agent matching code only through grep and short `git show` slices, not end to end. Config defaults for `matchTolerance` and the limits were not read.

---

## 1. Real AP fraud patterns and frequency

| Pattern | What it looks like | Frequency evidence |
|---|---|---|
| **Vendor bank-detail change (BEC, supplier impersonation)** | A fraudster poses as a known vendor and asks for a new payout account. | AFP 2025 survey: BEC was cited by 63% of respondents for 2024 activity (the same survey reports 79% of organizations hit by attempted or actual payments fraud). Source: <https://www.financialprofessionals.org/about/learn-more/press-releases/Details/survey-79-percent-of-organizations-were-victims-of-attempted-or-actual-payments-fraud-activity-in-2024>, excerpt: "BEC was the top avenue for attempted and actual payments fraud, cited by 63% of respondents". |
| **BEC via compromised supplier mailbox** | The real vendor's email is hijacked and used to send the change. | FBI IC3 PSA 2023: "fraudsters using access to email accounts to time the fraudulent request for a change in payment type or a switch to a different bank account". Source: <https://www.ic3.gov/PSA/2023/PSA230609>, excerpt from the search result: "Business Email Compromise: The $50 Billion Scam" (cumulative losses October 2013 to December 2022). |
| **CEO / executive fraud** | An impersonated executive instructs an urgent payment. | AFP 2026 survey (2025 activity), commentary on the report: "close to 60% involves threat actors posing as senior executives". Source: <https://www.truist.com/content/dam/truist-bank/us/en/documents/info/cci/2026-afp-payments-fraud-control-survey-report-key-highlights.pdf> (cited via search result, not opened). |
| **Fake vendor** | An invoice from a supplier that does not exist, paid into an account the buyer controls or a fraudster controls. | ACFE, billing schemes: one secondary outlet reports "billing fraud accounted for 23% of asset misappropriation cases". Source: search excerpt, <https://it-online.co.za/?p=320501>. **UNVERIFIED** against the ACFE primary report. |
| **Duplicate payment** | The same invoice is paid twice, often with a changed number, date or amount. | No frequency figure found. The fuzzy-duplicate sources (section 2) describe the pattern qualitatively. Source: <https://www.spendesk.com/blog/duplicate-invoices/>, excerpt not retrieved. Treat as qualitative. |
| **Invoice splitting under limits** | One invoice is divided into amounts below an approval threshold. | Not quantified in any source I found. Covered by per-payment and daily limits in the design (section 2). |
| **Inflated amounts** | Invoice total exceeds the PO or goods received. | Covered by three-way match. Quantified: none found. |
| **Collusion** | Staff and a vendor cooperate. | ACFE 2026 "84% of perpetrators displayed at least one behavioral red flag" (secondary, unverified). Source: <https://bradyware.com/2026-acfe-fraud-report-insights/>. |
| **Fake goods receipt** | A receipt is recorded for goods that were never delivered. | Not quantified. Addressed in the design by a separate receiving role (TRUST.md, "Threats from upstream of the agent"). |

### Latest figures and their spread

- **AFP, 2025 survey (2024 activity), 521 practitioners, January 2025.** Source: <https://www.financialprofessionals.org/about/learn-more/press-releases/Details/survey-79-percent-of-organizations-were-victims-of-attempted-or-actual-payments-fraud-activity-in-2024>. Excerpt: "79% of organizations reported payments fraud attempts or actual fraud in 2024". BEC: 63%. Trend, per Digital Transactions: "down from 71% in 2022 and 68% in 2021" (<https://www.digitaltransactions.net/?p=1328294>).
- **AFP, 2026 survey (2025 activity), 465 practitioners, January 2026.** Overall fraud: 76%. BEC: **74%** in one AFP-linked source (<https://www.greensheet.com/newswire&article_id=63669>) and **70%** as "top avenue" in another. The two numbers may measure different things. **Unresolved.** Source for 76%: <https://www.financialprofessionals.org/training-resources/resources/survey-research-economic-data/Details/payments-fraud>.
- **FBI IC3 Internet Crime Report 2025 (published 2026).** BEC losses: "$3,046,598,558", with 24,768 complaints, against "$2,770,151,146" in 2024. Source for the figure: a third-party write-up that cites the FBI PDF, <https://abnormal.ai/blog/ai-cybercrime-ic3-report-2025>, plus the FBI PDF at <https://uploads.finsidersbrasil.com.br/2026/04/2025_IC3Report.pdf> (a mirror; check the IC3 original at ic3.gov). Overall reported losses: about $20.9 billion. Some sources give AI-linked BEC losses of about $30 million; **UNVERIFIED** and the figures vary.
- **IC3 PSA on BEC (latest found, 2023).** The search found no FBI PSA on BEC after 2023. Source: <https://www.ic3.gov/PSA/2023/PSA230609>. **Check ic3.gov for any later PSA before citing.**

**SignOff relevance.** The demo's threats map to these patterns: the changed payee (BEC and fake vendor), the duplicate, the over-limit and the missing receipt (fake goods receipt). The "injected instruction" case has no frequency figure, and it is an LLM-specific threat (section 6).

---

## 2. How real systems decide

### 2a. Two-way and three-way match, with tolerance

- **Definition.** Corpay: three-way matching "stops payment unless the purchase order, receiving record, and supplier invoice agree" (<https://www.corpay.com/resources/blog/three-way-matching>, excerpt via search).
- **Tolerance.** One ERP-vendor explanation: "Zero tolerance requires exact matches, while percentage or dollar tolerances let minor variances pass automatically and flag larger ones." Source: search excerpt from the same Corpay result set; also Sage X3 "Matching tolerance" (<https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESMAT.htm>, excerpt not retrieved).
- **Tolerance by category.** "a 5% variance is trivial on a small invoice but material on a large one" (vendor blog, <https://paystreamadvisors.com/blog/three-way-matching/>, excerpt via search). Supports SignOff's combined absolute-and-percentage rule.
- **Exception rate.** "exception rates above 20-25% may mean thresholds are too tight" (vendor guide, excerpt via search). Use as a rule of thumb, not a standard.
- **Two-way vs four-way.** "Two-way matching skips the receipt. Sources generally treat it as acceptable for services but risky for physical goods." (search excerpt). Four-way adds inspection (vendor descriptions).
- **Standard status.** No COSO or audit standard was found in the search. The tolerance practices are vendor descriptions.

**SignOff implementation, read from code.** Warden: `apps/warden/src/checks.ts` (branch `origin/feat/console-redesign`):

- `Tolerance` type and `toleranceMinor`, lines 45-56: "The larger of the absolute allowance and the percentage allowance on the given amount."
- `matchVerdict`, lines 76-108: invoice vs PO gap (line 94) uses `toleranceMinor(purchaseOrder.amountMinor, tolerance)`. The receipt must cover the invoice less tolerance: `covered = invoice.amountMinor - toleranceMinor(...)` (line 103), else `AMOUNT_MISMATCH` hold (line 105).
- Missing PO or receipt returns `hold('MISSING_EVIDENCE', ...)` (lines 85, 88, 101).
- `config.ts` line 41-43: `matchTolerance` with `absoluteMinor` and `basisPoints` bounds. Default values not read.

Agent: `apps/agent/src/match/match.ts`, lines 82-170:

- Amount vs invoice: `AMOUNT_MISMATCH` (line 112), `AMOUNT_EXCEEDS_ORDER` (line 130), `AMOUNT_EXCEEDS_RECEIPT` (line 140) when `invoice.amountMinor > receipt.receivedMinor`. **This is zero tolerance on the receipt.**

**Inconsistency to resolve.** The Warden allows the receipt to be short by the tolerance (checks.ts 103-105). The agent holds any receipt shortfall (match.ts 139-140). The agent is stricter, so the combined system holds more often than Warden alone would. That is safe, but the two rules should be stated the same way in the docs and the tests. See recommendation R-3.

### 2b. Vendor master controls and callback verification

- **Dual control on bank fields (ERP).** SAP: "Dual control applies only to fields you designate." Configuration path "Define Sensitive Fields for Dual Control (Vendors)". Source: <https://userapps.support.sap.com/sap/support/knowledge/en/3749979> (search excerpt; KBA 3749979 is about checker and maker on existing bank details, not new vendors).
- **Payment block until confirmed.** SAP article (search excerpt): "the account is automatically blocked for payment run till the changes are confirmed. Confirmation is done in FK08." Source: an SAP Knowledge Base article returned in the same search (ID not recorded; check SAP support for the exact KBA).
- **Separation of duties.** SAP R/3 documentation (excerpt): "both actions can never be performed using the same user ID". Source: <https://sapinsider.org/monitor-sensitive-fields-with-r-3s-dual-control-functionality/>.
- **Callback.** FBI (2018 PSA, excerpt via a 2018 Michigan-linked warning): businesses should "verify any account changes with a known legitimate business partner or entity by phone". Source: search excerpt, <https://www.ic3.gov/PSA/2018/PSA180611>. The callback must use contact details already on file, not details in the request (TRUST.md, "Supplier enrolment", step 3).

### 2c. Fuzzy duplicate detection

- Exact matching misses near-duplicates: "most real-world duplicates differ by one or two characters, a date offset, or a whitespace inconsistency." Source: vendor blog, search excerpt, <https://www.stampli.com/resources/duplicate-invoice-detection/>.
- Edit distance for IDs: "useful when a reference is almost correct but contains a typo, a missing character, or an extra zero." Source: <https://www.docsumo.com/blog/duplicate-invoice-detection> (search excerpt).
- Weighted multi-field scoring: invoice number and amount highest, date and vendor as confirming signals; threshold "roughly 85–90%" as a typical starting range. Source: <https://invoicedataextraction.com/blog/fuzzy-matching-accounts-payable>. **Rule of thumb only; no benchmark found.**
- Amount tolerance is numeric, not text: "a total off by a few cents is a tolerance problem." Source: search excerpt, same result set.
- Human review of borderline pairs: "a similar number with different amounts may be legitimate sequential billing." Source: <https://www.spendesk.com/blog/duplicate-invoices/> (search excerpt).

**SignOff today.** The Warden uses an exact key: `DUPLICATE` at `apps/warden/src/service.ts` line 849 ("this payable already has an unresolved or settled payment"), with the obligation key from `normaliseInvoiceNumber` and `obligationKey` in `packages/shared/src/node.ts` (imported at `apps/agent/src/match/match.ts` lines 3-8). The agent's `DUPLICATE_PAYMENT` check (`match.ts` line 161) uses the same key. This catches exact repeats after normalisation. It does not catch a near-duplicate with a changed number.

### 2d. Velocity and limit rules

- Per-payment, per-supplier and daily limits: `limitVerdict` in `checks.ts` lines 111-127, each read from the current limits at decision time. Excess is a `hold('OVER_LIMIT', ...)`.
- Daily usage counts paid and in-flight attempts on the same SAST day: `dailyUsage` lines 59-73, `sastDay` lines 32-36 (UTC+2 with no daylight saving). This is a real SA-time reset, which matches the buyer context.
- **Invoice splitting.** The design counts supplier-daily and total-daily usage, which catches splitting within a day. It does not catch splitting across days or across suppliers that are the same company. No source found quantifies this; it is a design gap, see R-6.

### 2e. Anomaly scoring versus deterministic rules

- Rules: "effective for anomalies with known, fixed characteristics: amounts above a threshold, duplicate invoice numbers within the same entity, payments to blacklisted counterparties." Source: vendor blog excerpt, <https://www.houseblend.io/articles/en/netsuite-detection-anomalie-facture-fournisseur> (search excerpt). Vendor material.
- Academic: a 2024 DFKI paper on journal-entry testing finds that "depending on selected filter criteria, JETs can lead to a high number of false positives" and that rule-based and ML-based combinations are under-studied. Source: <https://dfki.de/fileadmin/user_upload/import/15550_2024_ICAA.pdf> (search excerpt). Its data is synthetic, so its results are not validated on real AP records.
- Explicit limit of ML: it "does not replace human judgment about whether an anomaly represents a genuine problem". Source: <https://www.learnsignal.com/blog/ai-fraud-anomaly-detection-finance/> (search excerpt). Vendor material.
- No peer-reviewed comparison on real AP data was found.

**Which is better for money movement, and why (my recommendation).** Deterministic rules for the decision to pay. Reasons:

1. A payment is irreversible on the ledger. An auditor can replay a rule. A score cannot be explained to a finance lead in the same way.
2. Rules fail closed, which is the design requirement (BUILD-BRIEF: "Deterministic logic holds conflicting or incomplete outcomes").
3. No labelled AP dataset exists for SignOff to train an anomaly model. A model would be unmeasured.

Use an anomaly score only as a **triage signal** for a person to review, never as the signer's input. This matches the brief's swarm design, where review agents propose and Warden decides.

---

## 3. What information decisions use

| Record | Needed for | Where it lives in a real company | Source |
|---|---|---|---|
| **Vendor master, with verified payout details** | Payee check (`PAYEE_CHANGED`) and identity | Xero: contacts with bank details (manual entry). QuickBooks Online: vendor record; audit log CSV export for admins. SAP: vendor master, dual-control fields. Odoo: partner bank accounts. | Xero/QBO/SAP per sections 2b and below |
| **Purchase order** | Invoice vs PO match | Xero: PO and bill linking (native, 2-way). Odoo: PO module. SAP: PO. | Xero: <https://approveit.today/blog/xero-purchase-orders-2-3-way-matching-explained-for-finance-teams> (search excerpt) |
| **Goods received note (GRN)** | Receipt cover (`AMOUNT_EXCEEDS_RECEIPT`) | Odoo: native "Received quantities" bill control. Xero: GRN needs a third-party add-on (ApprovalMax). | Odoo: <https://www.odoo.com/documentation/17.0/fr/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html>; Xero: <https://blog.approvalmax.com/?p=1730> |
| **Policy and limits** | Limits, tolerance | Written policy plus system settings. No single source. | Design: `checks.ts` 111-127 |
| **Payment and invoice history** | Duplicate and daily usage | ERP payment register, bank statements. | Design: `dailyUsage` 59-73 |

### Odoo detail (search excerpt)

- "Once enabled, bills show a 'Should Be Paid' field." Source: <https://www.odoo.com/documentation/17.0/fr/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html>.
- The feature "only works when Bill Control is set to Received quantities" (17.0 and 16.0 docs). The 12.0 sources disagree (delivered vs ordered). **Check the version.**

### Xero detail (search excerpt)

- Native: bills can be "created directly from purchase orders". 2-way matching is practical. A product-ideas forum post says Xero "currently lacks a mechanism to track discrepancies between purchase orders, goods received, and bills". User-submitted; **UNVERIFIED** against Xero help.
- GRN: third-party (ApprovalMax, Approveit, Edify, Dext). Source: <https://support.approvalmax.com/en/articles/413770-can-i-see-the-goods-received-status-grn-in-xero-bills>.

### QuickBooks Online detail (search excerpt)

- Audit log exported "as a CSV from the Audit Log page", admin roles only. Source: <https://community.intuit.com/articles/1145887> (search excerpt).
- Retention: sources disagree (one says two years). **UNVERIFIED.** Check Intuit's own docs.

### Sage Business Cloud and SAP Ariba

No usable result. **Not covered.**

### How a small business without an ERP supplies the records

**What SignOff should assume (recommendation).** The buyer exports four CSV files from whatever it uses, or fills a spreadsheet:

1. `suppliers.csv`: supplier ID, legal name, enrolled payout account, status (approved or not), enrolment evidence reference.
2. `purchase_orders.csv`: PO number, supplier ID, currency, amount.
3. `goods_received.csv`: PO number, received amount, date, receiver ID (must differ from the PO raiser).
4. `policy.json`: limits and tolerance, with a version number.

This matches the existing `SupplierMasterFile` and evidence register shape (`apps/agent/src/match/supplier-master.ts` lines 11-21; `apps/warden/src/evidence.ts`). Document the mapping from Xero, QBO and Odoo exports to these four files. Do not claim an API integration.

---

## 4. Data for the demo

### 4a. Real public data

- **Receipt and form datasets (SROIE, CORD, FUNSD).** These are receipts and forms, not B2B invoices. Source: <https://arxiv.org/pdf/2408.06345> (search excerpt for general context). Licences were **not** confirmed. The search excerpt says "the license may allow academic research but restrict commercial training, redistribution, hosted demos, or model evaluation". Source: search excerpt, invoicedataextraction guide. **UNVERIFIED for each dataset.** Check each dataset page and the licence file before any public use.
- **Vendor lists.** The OpenCorporates-style aggregators index registries (see section 5). Do not use them as demo data because their terms were not checked.
- **Fraud datasets.** **Not researched.** Do not claim any.

### 4b. What must be synthetic

Everything that makes a decision. Vendor names, bank accounts, PO numbers, goods receipts, policies, and every invoice in the demo. Real vendor data would contain personal and banking information (TRUST.md, "Credential metadata on the ledger is public").

### 4c. How to label synthetic data honestly

1. Prefix every synthetic identifier with `sim_`, for example `sim_SUP-001`, `sim_INV-2026-0042`, and bank accounts `sim_ACC-…`.
2. Put a SIMULATED label in every rendered view and every exported report. The repo already does this: `apps/agent/src/eval/report.ts` line 22-23 prints "SIMULATED. No language model was called." and `apps/agent/src/eval/simulated-model.ts` line 16-17 uses labels `simulated:rule-based-extractor` and `simulated:rule-based-baseline`.
3. Keep the simulated label visible on the receipt, so a judge cannot read a simulated payout as a real one.

### 4d. Labelled set for fraud cases and how many give a usable error estimate

Cases to label (matching the brief's acceptance list): changed payee, duplicate, over-limit, missing receipt, injected instruction, plus a clean control set.

**Sample size, my arithmetic.** For zero failures in n trials, the exact one-sided 95% upper bound on the error rate is 1 - 0.05^(1/n) (Clopper-Pearson, one-sided). Source for the Clopper-Pearson definition: CASRAI guide, <https://casrai.org/guides/confidence-interval-for-a-proportion/> (search excerpt); a Cross Validated note on the rule of three, <https://stats.stackexchange.com/questions/497548/revisiting-the-rule-of-three> (search excerpt, Q&A).

| n failure-free cases | Upper bound on error rate, one-sided 95% (MY ARITHMETIC) |
|---|---|
| 60 | 4.9% |
| 100 | 2.95% |
| 299 | about 1.0% |
| 2,995 | about 0.1% |

Note: the Cross Validated thread gives a bound of about 0.019 for n = 100. My formula gives 0.0295 for the same case. The two differ, so I rely on my formula and mark the thread's figure as **unresolved**. Check with a stats reviewer.

**Practical answer.** About 100 cases per fraud type and 100 clean cases gives an error upper bound near 3% when zero errors occur. That is usable for a demo claim of "no missed cases in this set" and nothing wider. Report the count and the interval, and never state an accuracy without them.

**Labelled-set rule.** Warden rules are checked against labels, and the agent's extraction against a separate set. Keep the sets separate, so a rule cannot be tuned on the set it is scored on.

---

## 5. Fact-checking supplier identity

| Check | Real-world source | Free or paid | SignOff can do | Evidence |
|---|---|---|---|---|
| **CIPC company registration (South Africa)** | CIPC via cipc.co.za and BizPortal; third-party sites | Fees differ across sources. Official search cost **UNVERIFIED**. | **SIMULATE** only. A fixed registry list in the demo. | Excerpt: "CIPC offers a free company search in South Africa" (one guide); another: "the public CIPC search doesn't show everything" (<https://www.govchain.co.za/verify-company>). Sources conflict; check <https://www.bizportal.gov.za> |
| **PACRA company search (Zambia)** | PACRA search at search.pacra.org.zm | Public search, free per one guide. Certificate of Existence: fee. Name-search fees conflict (ZMK 50 vs K120). | **SIMULATE**. | Excerpt: "PACRA's Terms of Use prohibit bulk automated scraping". Source: <https://businessdataguide.com/blog/jurisdictions/zambia-company-search-guide> (search excerpt). **Verify the Terms of Use on PACRA's own site before any automated lookup.** |
| **VAT number validation (South Africa)** | SARS eFiling VAT vendor search | Free, no login. Weekly update. | **SIMULATE** in the demo. A real check would be a manual lookup, not an automated call, unless SARS offers an API. | Excerpt (search summary of the SARS VAT vendor search, not the SARS page itself): "The database is updated weekly, so a newly registered vendor may not appear yet". Source: <https://www.sars.gov.za/types-of-tax/value-added-tax/faqs-for-vat-vendors-on-tax-relief/>, not opened. Excerpt on format: "the format carries no check digit" (search summary, <https://www.commenda.io/blog/south-africa-vat-number-verification>). |
| **Bank account verification (AVS, South Africa)** | Bank-operated real-time checks; providers include Experian, Netcash, TransUnion | Paid per check. Price **UNVERIFIED**. | **SIMULATE**. | Excerpt: "AVS enables the verification of individual or corporate bank account information of participating banks." Operated by BankServAfrica (search excerpt, <https://www.standardbank.co.za/southafrica/business/products-and-services/security-centre/protect-yourself/account-verification-services>). Coverage varies by bank. Warden's own identity module says the same: "Here it is simulated" (`apps/warden/src/identity.ts` lines 5-8). |
| **Sanctions lists** | OFAC Sanctions List Service (SLS), with API; OpenSanctions republishes OFAC for a fee | OFAC free; OpenSanctions "pay-per-use". | **LIVE check is possible but not built.** Screening is a legal obligation for a real payment, so this must be reviewed by counsel before a pilot. | Excerpt: "OFAC's Sanctions List Service is now its main delivery channel, and it offers both a user interface and an API." (<https://sanctionslist.ofac.treas.gov/Home/static/index.html>). OFAC website terms of use **not found**. |
| **Domain age and email authentication** | DNS lookups; DMARC policy | Free | Can be LIVE, but unbuilt. | Excerpt: "A p=reject policy requests that receivers reject messages that fail DMARC." (<https://dmarcreport.com/dmarc-policy/>). Vendor blogs say RFC 7489 was superseded in May 2026 by RFC 9989-9991. **UNVERIFIED**; confirm on the IETF datatracker. |

### Which SignOff can only simulate

- CIPC and PACRA registry lookups: simulate. A real lookup needs the registry's terms and fees.
- AVS bank verification: simulate. This is the single most important check for changed payouts, so it must be named as the missing control.
- VAT validation: simulate.
- Sanctions screening: simulate. A real pilot needs it, and it is legally required (counsel).
- DMARC and domain age: could be live. Low risk to build, but out of scope for the hackathon.

---

## 6. Agent memory and context

### Short-term (per-invoice working context)

- Anthropic's engineering article describes context as "the smallest set of high-signal tokens that makes the desired outcome most likely", and structured note-taking outside the context window. Source: <https://anthropic.com/engineering/effective-context-engineering-for-ai-agents> (search excerpt; secondary summaries only, not opened).
- For SignOff: each role gets only the invoice fields, the matched PO, the GRN, the supplier record and the policy version for that invoice. Nothing else.

### Long-term (supplier history, past decisions, policy versions)

- Keep long-term facts in a deterministic store (the Warden's evidence register and supplier master), not in model memory. The model then reads a snapshot per invoice.
- Record every Warden decision with its policy version. That is already the design ("policy version" in BUILD-BRIEF.md "Core flow").

### What must never go into model context

- Private keys and seeds (signer secrets are in Secret Manager per the brief).
- Full bank account numbers. Use a masked or hashed reference. `accountKey` in `match.ts` line 54 normalises for comparison; it should not be the value sent to a model.
- Operator credentials.
- Any other supplier's data beyond the one invoice.

### Provenance and trust levels

- Label every fact with its source and trust level: `invoice` (untrusted, supplier-written), `buyer-record` (buyer-maintained), `verified` (independently confirmed, e.g. a bank check), `policy` (operator-set).
- The MINJA paper shows that a query alone can inject malicious records into agent memory. Source: <https://arxiv.org/pdf/2503.03704> (search excerpt): "any user can influence agent memory with minimal requirements for execution".
- OWASP splits this from prompt injection (LLM01) as ASI06 "Memory and Context Poisoning". Source: search excerpt from <https://vectorize.io/articles/owasp-asi06>. Date of the split is unclear across sources.

### How memory can be poisoned, and prevention

1. **Write from untrusted text.** An invoice that says "remember this payee" writes a false record. Prevention: the model cannot write to the supplier master or policy. Writes come only from verified, Warden-approved events.
2. **Trigger-based injection.** A query containing a supplier name retrieves a planted instruction. Prevention: retrieved memory is data, labelled with trust, and never executed as an instruction.
3. **Persistence across invoices.** Prevention: time-bounded memory and a human approval for any long-term change.

**SignOff rule (recommendation).** Only the deterministic store is long-term. The model has no long-term memory. This removes the poisoning route entirely for the MVP.

---

## 7. What SignOff does today (branch `origin/feat/console-redesign`)

### Warden (`apps/warden/src`)

| Rule | Where | Input | Simulated? |
|---|---|---|---|
| Three-way match: PO gap within tolerance | `checks.ts` 76-96 | invoice, PO, `matchTolerance` | No |
| Receipt covers invoice less tolerance | `checks.ts` 100-106 | invoice, receipt, tolerance | No |
| Tolerance = max(absolute, basis points) | `checks.ts` 45-56 | amount, config | No |
| Per-payment, per-supplier, daily limits | `checks.ts` 111-127 | limits, supplier and day totals | No |
| Daily usage on SAST day, paid and in-flight | `checks.ts` 59-73, 32-36 | attempts | No |
| Pre-signing ledger facts (signer set, freeze, balance, trust line) | `checks.ts` 143-170 | ledger read | No |
| Duplicate payable | `service.ts` 849, 920 | obligation key | No |
| Payee identity | `identity.ts` 5-8 | fixed list | **Yes, simulated** |
| Pause stops co-signing | per BUILD-BRIEF and TRUST.md | operator control | Not read |

### Agent (`apps/agent/src`)

| Rule | Where | Input |
|---|---|---|
| Supplier name must match one enrolled supplier; unknown or ambiguous holds | `match/match.ts` 65-79 | supplier master; exact normalised name (`nameKey`) |
| Supplier must be approved | `match.ts` 97-98 | `supplier.status` |
| Invoice number, currency, amount vs PO | `match.ts` 105-130 | invoice, PO |
| PO must belong to supplier | `match.ts` 123-124 | PO |
| Receipt must exist and cover invoice (zero tolerance) | `match.ts` 134-140 | receipt |
| Payee account must match enrolled account | `match.ts` 144-158 | `enrolledPayeeAsPrinted` |
| Duplicate by obligation key | `match.ts` 161 | `alreadyPaid(key)` |
| Supplier master file: no duplicate IDs | `supplier-master.ts` 24-34 | file |

Supplier master: the buyer maintains it as a JSON file. There is no vendor-bank change workflow in the code. The cooling-off period, maker-checker and out-of-band confirmation from TRUST.md are **not implemented**. Check with `git grep -n "cooling\|cooloff" origin/feat/console-redesign` before claiming otherwise. I did not run that search in this session.

### TRUST.md

Records the design as "planned", "None of it is built or tested yet" (line 3). It names AVS and identity as **simulated in the demo** (enrolment step 2).

---

## 8. Gaps and recommendations, ranked

### MUST-FOR-DEMO

- **R-1. Label every external check as SIMULATED in the console and receipt.** The identity module already does this in code. Confirm the console shows it. Basis: section 5, and TRUST.md "Simulated in the demo".
- **R-2. Show three demo holds with real rule codes:** changed payee (`PAYEE_CHANGED`), over-limit (`OVER_LIMIT`), missing receipt (`MISSING_EVIDENCE`). Basis: BUILD-BRIEF acceptance list. These map to the fraud patterns in section 1.
- **R-3. Align the receipt tolerance between agent and Warden.** Agent: zero tolerance (`match.ts` 139-140). Warden: tolerance (`checks.ts` 103-105). Pick one rule and state it in both places. Test it with a receipt that is short by less than the tolerance.
- **R-4. Build a labelled `sim_` fixture set** covering changed payee, duplicate, over-limit, missing receipt, injected instruction and clean control. Report counts and a one-sided 95% upper bound (section 4d). Do not state accuracy without it.

### SHOULD

- **R-5. Near-duplicate detection.** Add a normalised-number and amount-tolerance check (edit distance on invoice number, numeric tolerance on amount, date window). Hold for review, do not auto-pay. Basis: section 2c.
- **R-6. Split-invoice detection across days and related suppliers.** Track by a normalised payee account, not only the supplier ID. Basis: section 2d design gap.
- **R-7. Document the four-file CSV input** (section 3) and map Xero, QuickBooks and Odoo exports to it. Do not claim an integration.
- **R-8. Write the cooling-off and maker-checker as an explicit gap** in TRUST.md, unless the code is found to implement them.
- **R-9. Check the dataset licences** before any public artifact uses SROIE, CORD or FUNSD (section 4a).

### LATER

- **R-10. Live AVS bank verification** with a licensed provider (section 5). Needs counsel and a provider contract.
- **R-11. Live CIPC, PACRA and SARS checks.** Confirm the terms and fees first (section 5). PACRA's terms prohibit bulk scraping (secondary source).
- **R-12. Sanctions screening** against OFAC SLS, with counsel review (section 5).
- **R-13. DMARC and domain age checks** on supplier email domains (section 5). Confirm the RFC status first.
- **R-14. Anomaly scoring** as a triage signal only, after a labelled baseline exists (section 2e). Never as the signer's input.

---

## Sources

- AFP 2025 release: <https://www.financialprofessionals.org/about/learn-more/press-releases/Details/survey-79-percent-of-organizations-were-victims-of-attempted-or-actual-payments-fraud-activity-in-2024>
- AFP 2026 highlights (Truist): <https://www.truist.com/content/dam/truist-bank/us/en/documents/info/cci/2026-afp-payments-fraud-control-survey-report-key-highlights.pdf>
- AFP 2026 coverage: <https://www.greensheet.com/newswire&article_id=63669>
- Digital Transactions AFP coverage: <https://www.digitaltransactions.net/?p=1328294>
- FBI IC3 PSA 2023: <https://www.ic3.gov/PSA/2023/PSA230609>
- FBI IC3 PSA 2018: <https://www.ic3.gov/PSA/2018/PSA180611>
- IC3 2025 report (mirror): <https://uploads.finsidersbrasil.com.br/2026/04/2025_IC3Report.pdf>
- IC3 2025 write-up: <https://abnormal.ai/blog/ai-cybercrime-ic3-report-2025>
- ACFE 2026 secondary: <https://it-online.co.za/?p=320501>, <https://bradyware.com/2026-acfe-fraud-report-insights/>
- Corpay three-way matching: <https://www.corpay.com/resources/blog/three-way-matching>
- Paystream three-way matching: <https://paystreamadvisors.com/blog/three-way-matching/>
- Sage X3 matching tolerance: <https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESMAT.htm>
- SAP dual control KBA: <https://userapps.support.sap.com/sap/support/knowledge/en/3749979>
- SAP R/3 dual control: <https://sapinsider.org/monitor-sensitive-fields-with-r-3s-dual-control-functionality/>
- Stampli duplicates: <https://www.stampli.com/resources/duplicate-invoice-detection/>
- Docsumo duplicates: <https://www.docsumo.com/blog/duplicate-invoice-detection>
- Invoice Data Extraction fuzzy matching: <https://invoicedataextraction.com/blog/fuzzy-matching-accounts-payable>
- DFKI 2024 journal-entry testing: <https://dfki.de/fileadmin/user_upload/import/15550_2024_ICAA.pdf>
- Odoo 17.0 bill control: <https://www.odoo.com/documentation/17.0/fr/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html>
- Xero + ApprovalMax GRN: <https://support.approvalmax.com/en/articles/413770-can-i-see-the-goods-received-status-grn-in-xero-bills>
- Intuit QBO audit log: <https://community.intuit.com/articles/1145887>
- CIPC: <https://www.govchain.co.za/verify-company>, <https://www.bizportal.gov.za/files/company_reg_guide.pdf>
- PACRA: <https://businessdataguide.com/blog/jurisdictions/zambia-company-search-guide>
- SARS VAT vendor search: <https://www.sars.gov.za/types-of-tax/value-added-tax/faqs-for-vat-vendors-on-tax-relief/> (search result, not opened)
- AVS: <https://www.standardbank.co.za/southafrica/business/products-and-services/security-centre/protect-yourself/account-verification-services>, <https://www.realpay.co.za/products/avs-r>
- OFAC SLS: <https://sanctionslist.ofac.treas.gov/Home/static/index.html>, <https://www.opensanctions.org/datasets/us_sanctions/>
- DMARC: <https://dmarcreport.com/dmarc-policy/>
- Clopper-Pearson / CASRAI: <https://casrai.org/guides/confidence-interval-for-a-proportion/>
- Rule of three thread: <https://stats.stackexchange.com/questions/497548/revisiting-the-rule-of-three>
- MINJA: <https://arxiv.org/pdf/2503.03704>
- OWASP ASI06 (secondary): <https://vectorize.io/articles/owasp-asi06>
- Anthropic context engineering: <https://anthropic.com/engineering/effective-context-engineering-for-ai-agents>

## Limitations and what I could not verify

- Search excerpts only; full primary pages were not opened.
- AFP BEC figure for 2025 is 70% or 74% depending on the source; unresolved.
- IC3 2025 BEC loss figure comes from a third-party write-up and an FBI PDF mirror; check ic3.gov.
- ACFE fictitious-vendor statistics not verified.
- Dataset and fraud-dataset licences not verified.
- SAP Ariba, Sage Business Cloud not covered.
- Warden config defaults and the cooling-off search (section 7) not checked.
- DMARC RFC status unverified.
- Sample-size numbers are my arithmetic; the Cross Validated thread disagrees and is unresolved.
