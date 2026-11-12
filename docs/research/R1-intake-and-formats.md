# Research R1: invoice intake and formats

Status: research note, docs only. Nothing here is built or changed in code. Code facts are from `origin/feat/console-redesign` (the stack branch), read on 12 November 2026. Each factual claim carries a source URL and a short quoted span, or is marked **unverified**.

## Limitations first

- **Primary sources I could not read:** the ZRA Smart Invoice pages and FAQ (TLS certificate error on both, so no ZRA text was obtained); the SARS VAT Act section 20 text (not read; the SARS page gives no section numbers); the FBI IC3 2025 report (the PDF returned no extractable text); the Zambian IGC policy brief PDF (no readable text).
- **Secondary only:** South African Peppol mandate timing, Zambian mandate scope and dates, BEC loss figures, SME channel shares, and Gmail bulk-sender thresholds come from vendor or advisory blogs. They are labelled as such and are not relied on for any design decision.
- **Not researched in this pass:** HEIC decoding, OCR accuracy and scan resolution, handwriting, stamps, zip-bomb thresholds in our parser, and hidden text in PDF annotations and metadata. These are listed as gaps, not claims.
- **No South African or Zambian survey of how SMEs send invoices was found.** The channel ranking in section 1 is therefore a reasoned ranking with weak evidence, not a measurement.
- Facts on this page are not legal advice. Tax rules need a tax adviser or counsel before any pilot.

## Summary

- **Verdict:** The intake accepts one format only, a text-layer PDF of at most 10 MiB, and holds everything else. That is a safe default for a demo fed with fictional text PDFs. It is not what real Southern African supplier invoices look like. Most real invoices arrive as phone photos, scans, Word or Excel files, or PDFs with no usable text layer, and many arrive inside an email rather than as a file dropped in a folder.
- **Largest gap:** The intake has no route for scanned or photographed invoices. Anything without a text layer is held as `NO_TEXT_LAYER` (`apps/agent/src/intake/intake.ts:102-105`). Nothing in the repo does OCR, so a real buyer would see most supplier invoices held without any extraction attempt.

---

## 1. How invoices really arrive

Ranking for small and mid buyers in Zambia and South Africa. **Evidence is weak.** No primary survey was found.

| Rank | Channel | Evidence | Confidence |
|---|---|---|---|
| 1 | Email attachment (PDF, Word, Excel, photo) | A UK HMRC-commissioned SME survey reports "PDF or email" as the most common method for sending and receiving invoices. Source: [gov.uk SME e-invoicing research](https://www.gov.uk/government/publications/electronic-invoicing-sme-usage-and-attitudes/electronic-invoicing-quantitative-research-into-small-and-medium-sized-enterprises-usage-and-attitudes). Quoted from a search summary, not read in full. UK data, so a rough comparison only. | Medium-low |
| 2 | WhatsApp (photo or PDF sent in chat) | A Techeconomy piece on African SMEs says "some businesses then issue invoices as photos or PDFs inside WhatsApp itself" ([techeconomy.ng](https://techeconomy.ng/whatsapp-operating-system-for-african-smes)). Not Zambia-specific and not a survey. Vendor blogs claim WhatsApp dominates SA SME invoicing; those figures are **unverified**. | Low |
| 3 | Paper, scanned or photographed | Printed invoices are still common in Zambia; no figure found. An ICT-SME study exists but only its abstract was seen. **Unverified.** | Low |
| 4 | Supplier portal or buyer's AP upload | A vendor notes that "some very formal corporate procurement processes require invoices submitted through a supplier portal rather than WhatsApp" (unattributed vendor blog, unverified). Plausible for large buyers, not for small ones. | Low |
| 5 | Watched folder, SFTP, EDI | Not found in any Southern African SME evidence. Likely limited to ERP-integrated mid-size buyers. **Unverified.** | Low |
| 6 | E-invoicing network (Peppol) | Not mandatory in South Africa yet (see section 3). Used by no SME evidence found. | Low |
| 7 | API | Rare for small suppliers; not found. | Low |

**What the ranking means for us.** The intake's only supported channel is a file in a folder (`apps/agent/src/intake/intake.ts:113-121`). That matches a buyer who saves email attachments to a folder by hand, the least common route for a supplier-side pipeline and a plausible route for an AP clerk. Email and WhatsApp are the real intake paths and neither is built.

## 2. Formats

| Format | What it looks like | What it needs | Intake today |
|---|---|---|---|
| Native text PDF | Vector text, selectable | pdf.js text extraction | **Accepted** (`intake.ts:94-106`, `pdf-child.mjs:46-69`) |
| Scanned or image PDF | Page is one image, no text layer | OCR with layout and a quality check | **Held** as `NO_TEXT_LAYER` (`intake.ts:102-105`) |
| Phone photo (JPG/PNG/HEIC) | Camera image, skew, shadows | Image decode, OCR, perspective correction; HEIC decode needs a separate library | **Held**: not a PDF signature, `UNSUPPORTED_FILE_TYPE` (`intake.ts:94-96`) |
| Word or Excel | DOCX/XLSX zip containers, macros possible | Office parser in a sandbox, or reject | **Held** as `UNSUPPORTED_FILE_TYPE` |
| XML e-invoice (UBL) | Structured XML | XML schema and EN 16931 rule checks | **Held** (no XML path) |
| Peppol BIS Billing 3.0 | UBL Invoice or UBL Credit Note; PDFs may be attached as supporting documents | Schematron validation | **Not supported** |
| ZUGFeRD / Factur-X hybrid | PDF/A-3 with embedded CII XML | Read the XML, check the PDF matches it | **Accepted as a PDF, XML ignored** |
| HTML email body invoice | Invoice inside an email | Email parsing, HTML sanitising | **Not supported** (no email path) |
| Multi-page, multi-invoice PDF | One file, several invoices | Split by invoice number and page | **Not supported**: the whole file is one unit (`pipeline.ts` treats each file as one invoice) |
| Password-protected PDF | Encrypted | Hold for a human | **Held** as `PDF_ENCRYPTED` (`pdf-child.mjs:71-73`) |
| Statement, invoice, credit note, pro-forma | Different documents | Type classification and rules for each | **Not classified.** Not checked by intake. |

**Format facts used above.**

- Peppol BIS 3.0 allows UBL Invoice and UBL Credit Note only in the landing list: "UBL Invoice" and "UBL Credit Note" ([docs.peppol.eu/poacc/billing/3.0/](https://docs.peppol.eu/poacc/billing/3.0/)). No CII syntax is listed there.
- Peppol attachment MIME codes include `application/pdf`, `image/jpeg`, `image/png`, `text/csv` and spreadsheet types. Rule PEPPOL-EN16931-CL001: "Mime code must be according to subset of IANA code list." ([codelist/MimeCode](https://docs.peppol.eu/poacc/billing/3.0/codelist/MimeCode/), [rules](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/)). No XML attachment rule was found; `application/xml` is not in the list.
- Credit note type code 381 is "Credit note" ([UNCL1001-cn](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL1001-cn/)). Rule PEPPOL-EN16931-P0101: "Credit note type code MUST be set according to the profile."
- Factur-X and ZUGFeRD are described as "un standard franco-allemand de facture électronique mixte (PDF pour les utilisateurs et données XML pour un traitement automatisé)" ([fnfe-mpe.org/factur-x](https://fnfe-mpe.org/factur-x/)) and as "Als hybrides Datenformat integriert ZUGFeRD in einem PDF-Dokument (PDF/A-3) strukturierte Rechnungsdaten im XML-Format" ([ferd-net.de](https://www.ferd-net.de/standards/zugferd)). Factur-X page: "Techniquement, Factur-X et ZUGFeRD sont identiques." Profiles listed: MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED. The embedded XML filename was not found on either page.
- Passwords: the child reports `PasswordException` as `ENCRYPTED` (`pdf-child.mjs:73`). No password is ever supplied, so an encrypted file is held.

## 3. Real-world requirements

### South Africa (VAT)

- Full tax invoice above R5 000. Quote: "A business is required to issue a full tax invoice when the price is more than R5 000" ([SARS tax invoices](https://www.sars.gov.za/businesses-and-employers/tax-invoices/); page "Last Updated: 11/03/2021").
- Abridged invoice at or below R5 000. Quote: "may issue an abridged tax invoice when the consideration for the supply is R 5 000 or less than R5 000." Same page.
- No invoice needed at R50 or less. Quote: "If the consideration for the supply is R50 or less, a tax invoice is not required." Same page.
- Validity list from 8 January 2016. Quote: "As from 8 January 2016, the following information must be reflected on a tax invoice for it to be considered valid:" followed by a bullet list that includes "Serial number and date of issue of invoice." Same page. **The full bullet list was not fully extracted in the fetch; the statutory list in VAT Act s20(4) was not read.** Treat the field list below as **unverified until s20 is read**.
- Timing: the page refers to "21 days from the time the supply was made." Same page.
- Secondary (unverified, from practitioner blogs): a full invoice carries supplier and recipient names, addresses and VAT numbers; the words "Tax Invoice", "VAT Invoice" or "Invoice"; the date; a description; and the VAT amount. A quote or pro-forma does not qualify for input VAT.
- Consequence for us: a buyer cannot claim input VAT on an invoice missing mandatory fields, so the extractor must read the serial number, the date, supplier and buyer VAT numbers, and the VAT amount, and must treat a "Quote" or "Statement" as not an invoice.
- Mandate: SA has no mandatory Peppol e-invoicing yet. Secondary sources say SARS and National Treasury confirmed plans on 3 February 2026 for mandatory e-invoicing with near-real-time VAT reporting on a Peppol five-corner model, with 2028 as the target date and a consultation paper dated 17 August 2026 ([vatupdate.com, June 2026](https://www.vatupdate.com/2026/06/15/south-africas-peppol-e-invoicing-mandate-to-begin-with-large-b2b-businesses/); [KPMG TaxNewsFlash, Aug 2026](https://kpmg.com/us/en/taxnewsflash/news/2026/08/tnf-south-africa-public-consultation-on-e-invoicing-and-digital-reporting.html)). Unverified against SARS primary text.

### Zambia (ZRA Smart Invoice)

- The primary ZRA pages could not be read (TLS certificate error, twice). **Everything below is secondary and unverified.**
- Secondary sources say the regime rests on SI No. 58 of 2023 and that mandatory use began 1 July 2024, with ZRA enforcement from 1 October 2024 ([edicomgroup](https://edicomgroup.com/blog/mandatory-electronic-invoicing-zambia-smart-invoice); [vatupdate, 2024](https://www.vatupdate.com/2024/02/23/zambias-countrywide-e-invoicing-program-requires-compliance-by-1-july-2024)).
- The IGC abstract says: "Since 2024, all Zambian firms must use electronic (“smart”) invoices for Value-Added Tax (VAT) reporting" ([theigc.org](https://www.theigc.org/publications/e-invoicing-adoption-under-loadshedding-zambia)). Scope differs between sources (VAT-registered only, or all taxpayers). **Unresolved.**
- The same IGC abstract says the research is "Based on interviews with 61 firms". It is the only sample size found for Zambian smart invoicing, and the brief's body could not be read.
- Secondary sources list buyer TPIN, ZRA classification codes, VAT rate and an invoice-number scheme as required fields, with credit and debit notes validated in the system. **Unverified.**
- Consequence for us: a Zambian buyer may receive smart-invoice output (with a QR or fiscal code) that the extractor has never seen. We do not know the fields. Get the ZRA FAQ before claiming any Zambian field list.

### Fields the extractor must read (for now)

From the SA section above, plus common sense: supplier name, supplier VAT number, buyer name, invoice number, invoice date, line description, quantity, unit price, VAT rate, VAT amount, total, currency, and document type (invoice, credit note, quote, statement). Buyer VAT number is required on full invoices. Bank details are read only to be compared with the verified supplier record, never used as payee (`docs/RULES.md` R-7).

## 4. Edge cases

| Case | Current behaviour (code) | Recommendation |
|---|---|---|
| Duplicate send, same bytes | Skipped by fingerprint, `intake.ts:140-142`; seen set seeded from audit log, `main.ts:293` | Good. Keep. |
| Duplicate send, different bytes (re-saved PDF) | Accepted as a new file. Dedupe on invoice number is not in intake. | SHOULD: key the obligation by supplier and invoice number, not bytes (ENGINEERING.md, stable obligation identity). Warden owns this. |
| Same invoice number, different file | Not detected by intake | SHOULD: hold for review, as ENGINEERING.md requires an explicit alias mapping. |
| Revised invoice | Treated as new file | SHOULD: hold; never auto-pay a revision. |
| Credit note | Not classified | MUST-FOR-DEMO if the demo includes one: hold it, never pay it. |
| Foreign currency | Not handled | SHOULD: hold any currency not ZAR or the policy currency. |
| Other languages | Injection rules are English regex only (`screen/injection.ts:58-108`) | SHOULD: note as a known gap; an Afrikaans, Bemba or French phrase can pass the screen. |
| Handwriting, stamps | No OCR; scans held | LATER |
| Low-resolution scans | Held as no text layer | LATER with OCR |
| Corrupted file | Held as `PDF_UNREADABLE` (`pdf-child.mjs:71-73`) | Good. |
| Oversize file | Held before reading (`intake.ts:79-81`) | Good. |
| Zip bomb | Not applicable: zip is not accepted. Holds because the signature check fails, `intake.ts:94-96` | Good for now. If zip is ever added, use CWE-409 controls: "Check uncompressed size before extraction" (secondary, unverified). MITRE CWE-409 defines the risk: "The product does not handle or incorrectly handles a compressed input with a very high compression ratio that produces a large output." |
| Malware in attachment | Parsed in a child with empty env, 256 MB heap, 20 s limit, 4 MB output (`pdf-text.ts:11-15, 50`) | OWASP: "Run the file through an antivirus or a sandbox if available" (SHOULD for real pilot). |
| Hidden text (white text) | Included on purpose (`intake.ts:38`), so the screen can read it | Good. Keep. |
| Prompt injection in PDF | Screen before any model (`pipeline.ts:202-203`); four rule codes (`injection.ts:9-10`) | OWASP LLM01: "prompt injections do not need to be human-visible/readable, as long as the content is parsed by the model." Regex screen only catches the named phrases. SHOULD: treat the screen as a tripwire, not a control, which the stack already implies. |
| Metadata and annotations | Not read. pdf.js `getTextContent` returns page text only. **Unverified** whether annotations are included. | SHOULD: test with a fixture that has a white-text annotation. |
| Password-protected PDF | Held as `PDF_ENCRYPTED` | Good. |
| Multi-invoice PDF | Whole file is one invoice | SHOULD: detect more than one invoice number and hold. |

## 5. Security of intake

- **File type.** OWASP: "List allowed extensions. Only allow safe and critical extensions for business functionality" and "validating the file's signature can be checked and verified against the expected file that should be received." It adds: "This should not be used on its own, as bypassing it is pretty common and easy" ([OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)). Our intake checks the `%PDF-` signature at offset 0 and ignores the extension (`intake.ts:94`). That is the signature check OWASP describes, but **it is not enough alone**: the PDF is still parsed by pdf.js, which is the real defence surface. Good: the parse runs in a child.
- **Size limits.** OWASP: "The application should set proper size limits for the upload service in order to protect the file storage capacity." Done (10 MiB, `intake.ts:15`).
- **Malware scanning.** OWASP: "Run the file through an antivirus or a sandbox if available to validate that it doesn't contain malicious data." Not done. The child is a sandbox of sorts (no env, no network code, `pdf-child.mjs:1-3`), but it has no OS-level isolation. **Gap.**
- **CDR for PDFs.** OWASP: "Run the file through CDR (Content Disarm & Reconstruct) if applicable type (PDF, DOCX, etc...)". Not done. LATER.
- **Renaming and storage.** OWASP: "Change the filename to something generated by the application". Intake keeps the operator's filename in its key path (`intake.ts:139`, `listInbox`). Acceptable for a local inbox; not for a web upload. Not an issue now.
- **Email authentication (BEC).** The FBI reports BEC as a large loss category. Secondary figures: "24,768 BEC complaints" and "$3.046 billion" for 2025 ([abnormal.ai summary](https://abnormal.ai/blog/ai-cybercrime-ic3-report-2025)). **Unverified** against the FBI report, which was not readable. DMARC requires alignment: "DMARC authenticates use of the RFC5322.From domain by requiring that it match (be aligned with) an Authenticated Identifier" ([RFC 7489 §3.1](https://www.rfc-editor.org/rfc/rfc7489)). SPF does not authenticate the From header: SPF "do[es] not provide assurance about the authorization/authenticity of other identities used in the message", including "the From: header field" ([RFC 7208 §11.2](https://www.rfc-editor.org/rfc/rfc7208)). DKIM proves only: "Verifying the signature asserts that the hashed content has not changed since it was signed" and "asserts nothing else about 'protecting' the end-to-end integrity of the message" ([RFC 6376 §1.5](https://www.rfc-editor.org/rfc/rfc6376)). **Implication:** a DKIM or SPF pass on an email does not prove the invoice's supplier. Supplier identity must come from the verified supplier record, not from the sender.
- **Sender allow-list.** Not built. SHOULD for email intake: accept only from enrolled supplier domains, and require DMARC alignment for those domains.
- **Dedupe by hash.** Built: SHA-256 of bytes (`intake.ts:93`). Good for exact re-sends; not for re-saved invoices.
- **Evidence retention.** The file's fingerprint and outcome are recorded (`main.ts:293`, the audit log). The raw held file's retention is not specified in the code. **Unverified.**

## 6. What SignOff does today (stack branch)

Quoted from `origin/feat/console-redesign`:

| Behaviour | Where |
|---|---|
| Inbox is a folder polled every interval; only top-level names, hidden files and `~` lock files skipped | `apps/agent/src/intake/intake.ts:113-121` |
| Symbolic links and non-files held as `NOT_A_REGULAR_FILE`, via `lstatSync` | `intake.ts:68-74` |
| Size held above 10 MiB, checked before read and again after read | `intake.ts:15, 79-81, 90-92` |
| Signature must be `%PDF-` at offset 0, else `UNSUPPORTED_FILE_TYPE` | `intake.ts:20, 94-96` |
| PDF parsed in child: `env: {}`, 256 MB heap, 20 s timeout, 4 MB output | `pdf-text.ts:11-15, 47-50, 14-15` |
| Child rejects over 200 pages and over 200 000 characters per page | `pdf-child.mjs:25-26, 60-61`; `pdf-text.ts:28` |
| Encrypted PDF held | `pdf-child.mjs:71-73`; `intake.ts:28` |
| Text under 20 printable characters held as no text layer | `intake.ts:17-18, 102-105` |
| Hidden text kept on purpose for the screen | `intake.ts:38` |
| Dedupe by SHA-256 across runs; seen set seeded from the audit log | `intake.ts:135-148`; `main.ts:293` |
| Injection screen before any model call | `workflow/pipeline.ts:195-203`; `screen/injection.ts:118` |
| Tests: 24 intake and parser cases (15 intake, 9 PDF parser) | `apps/agent/test/intake/intake.test.ts`, `pdf-text.test.ts` |

**Accepted:** only PDFs with a text layer, under 10 MiB, under 200 pages, not encrypted.
**Rejected or held:** everything else, including images, Word, Excel, XML, HTML, email, zip.
**Gap in the code:** the intake calls `extract` on each file on every poll, *before* the seen check (`intake.ts:138` then `intake.ts:140`). A large file in the inbox is therefore re-parsed on every interval (up to 20 s each) even after it was handled. The seen check only stops the second *outcome* being reported. This is an efficiency and availability gap, not a correctness gap.

## 7. Gaps and recommendations, ranked

| # | Gap | Severity | Smallest change | Label |
|---|---|---|---|---|
| 1 | Real supplier invoices are often images or scans; the intake holds them all | High | Hold them openly and say so in the demo; state it in the README; do not claim OCR | MUST-FOR-DEMO (honest labelling) |
| 2 | Re-parsing of every inbox file on every poll (`intake.ts:138` before `:140`) | High | Move the seen check before `intakeFile`, keyed by a cheap pre-hash or name+size+mtime; re-hash only new files | MUST-FOR-DEMO (a slow demo or a stall would be visible) |
| 3 | No invoice-number dedupe; a re-saved PDF is paid twice | High | Key the obligation by supplier and invoice number (Warden, per ENGINEERING.md) | MUST-FOR-DEMO (acceptance case "duplicate" in BUILD-BRIEF) |
| 4 | No credit-note, revision or currency classification | High | Classify document type; hold anything not an invoice in ZAR | MUST-FOR-DEMO if demoed |
| 5 | No malware scan or CDR beyond the child process | Medium | Document the child as the only control; add a ClamAV scan as a SHOULD | SHOULD |
| 6 | Injection screen is English-only regex | Medium | Document as known gap; add a test with an Afrikaans or French phrase | SHOULD |
| 7 | No sender allow-list or DMARC check for email | Medium | Not needed until email intake exists; then accept only enrolled domains and require DMARC alignment | LATER (with email) |
| 8 | Multi-invoice PDFs not detected | Medium | Hold if more than one invoice number is found | SHOULD |
| 9 | Annotations and metadata not verified | Medium | Add one fixture with a white-text annotation and one with metadata injection | SHOULD |
| 10 | No OCR, HEIC, Word, Excel, XML | High for real use, low for demo | Out of scope for the demo; say so | LATER |
| 11 | ZRA field list unknown | High for Zambia | Read the ZRA FAQ from a browser that trusts the certificate, then update section 3 | MUST-FOR-DEMO if a Zambian format is claimed |
| 12 | Evidence retention of held files not specified | Low | Write the retention rule into docs/TRUST.md | SHOULD |

## Next steps for this lane (not done here)

1. Read VAT Act s20(4)-(6) and the SARS VAT guide from a source that loads, and replace the secondary field list in section 3.
2. Read the ZRA Smart Invoice FAQ and the SI 58 of 2023 text from a browser, and replace the Zambian section.
3. Extract the FBI IC3 2025 BEC figures from a text-capable copy and replace the secondary numbers.
4. Research HEIC, OCR accuracy at 200 to 300 dpi, and PDF annotations, which are not covered here.
