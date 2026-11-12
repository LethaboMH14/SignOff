# Data: public datasets and the fictional South African invoice generator

Lane J. Status: **Part 1 (datasets) and Part 2 (generator) built and tested on this branch. Not yet reviewed by the integrator.** Every row below was checked on 2026-11-12; where a figure came from a secondary page it is marked *not re-read*.

## Limitations, first

1. **No open-licensed South African invoice dataset was found.** The vault (`13-public-apis`, `07-ml-computer-vision`, `08-data-science`) has no invoice dataset entry; the only matches are generic finance APIs. GitHub and Kaggle searches returned no SA invoice set with a licence. Coupa publishes SA sample cXML invoices, but the pages showed no licence, so they are **not used**.
2. **The SARS field list is not verified against the statute.** Research note R1 (`origin/claude/research-r1-intake-c26aae:docs/research/R1-intake-and-formats.md`) says the s20(4) text of the VAT Act was **not read**, and treats the field list as unverified. The generator follows it, so it inherits that gap.
3. **The expected outcomes in `labels.json` are the generator's own intent, not a human audit.** They are correct by construction for the fictional data, but no one has checked them against an independent reading of the policy.
4. **Phone photos are approximated.** They use a rotation and an affine skew, not a true perspective transform. Scans use seeded speckle and noise; they do not model real scanner optics.
5. **Byte-identical output is guaranteed on one machine, not across operating systems.** Scanned and photo forms rasterise text with the system sans-serif font, so the bytes can differ on another OS. The determinism test regenerates twice on the same machine.
6. **No OCR or extraction accuracy is claimed here.** This document only describes data.

## Part 1: public datasets

Verdict key: **COMMIT** = licence clearly allows redistribution; **LOCAL-ONLY** = not committed, fetched by script, used only for measurement; **SKIP** = not used.

| Dataset | URL | Licence (quoted or read) | Commercial use and redistribution | Size | Format | Labels | SA-style fields | Verdict |
|---|---|---|---|---|---|---|---|---|
| **DocILE** (KILE/LIR benchmark) | https://docile.rossum.ai/ | Page: "Fill out the Dataset Access Request form to get access to the data for research purposes." Repo `rossumai/docile` is MIT (GitHub API). Dataset licence **not found**. | Access by request form only; dataset terms unverified. | not read | Images and PDFs | Key fields and line items with boxes | Not known | **SKIP.** Gated; we cannot submit a request for the owner, and the dataset licence is unverified. |
| **SROIE** (ICDAR 2019 receipts) | https://github.com/zzzDavid/ICDAR-2019-SROIE (repo) | Repo licence MIT (GitHub API). The README says the images come from the ICDAR challenge Google Drive. Image licence **not read**. | Repo MIT covers its own code and corrected annotations; the image licence is unverified. | 1 000 receipts (600 trainval, 400 test), from the README | JPG images, box text files, JSON fields | company, date, address, total | No (Malaysian receipts) | **SKIP.** Image terms unverified; receipts, not invoices. |
| **CORD** v2 (receipts) | https://huggingface.co/datasets/naver-clova-ix/cord-v2 · https://github.com/clovaai/cord | `license: cc-by-4.0` (HF card); GitHub API `CC-BY-4.0` | Yes, with attribution (CC BY 4.0 permits redistribution). | Parquet, 4 train shards, validation, test; total size *not re-read* | Images with nested JSON | menu items, subtotal, total | No (Indonesian receipts) | **LOCAL-ONLY.** Licence would allow COMMIT, but it is receipts, has no SA fields, and is not needed in the repo. Fetch with `scripts/datasets/fetch.ts`. |
| **FUNSD** (forms) | https://guillaumejaume.github.io/FUNSD/ | Terms: "Use of the FUNSD Dataset is solely for non-commercial, research and educational purposes." | Non-commercial only; no redistribution. | 199 forms per the FUNSD paper (*not re-read*) | Scanned forms with box annotations | question–answer links | No (US questionnaires) | **SKIP.** Not invoices; terms bar commercial use and must not ship. |
| **RVL-CDIP** (invoice class) | https://huggingface.co/datasets/chainyo/rvl-cdip · https://huggingface.co/datasets/aharley/rvl_cdip | Hugging Face tag `license: other`; the card points to the IIT-CDIP / Legacy Tobacco Documents terms, which were **not read**. | Unverified. | 400 000 images, 16 classes, about 25 000 per class (per the authors' paper, *not re-read*) | Scanned TIFF/PNG | document class only | No (scanned legacy documents) | **SKIP.** Terms unverified; the invoice class is old scanned paper, not a useful proxy for SA e-invoices. |
| **katanaml-org/invoices-donut-data-v1** (Sparrow) | https://huggingface.co/datasets/katanaml-org/invoices-donut-data-v1 | HF card `license: mit`. Its README says it derives from Kozłowski & Weichbroth (Mendeley `tnj49gpmtz`), whose licence field is **null**. | Conflict: the derivative says MIT, the upstream says nothing. Not safe to redistribute. | 501 examples (425 train, 26 test, 50 validation); 197.5 MB download (HF card) | Images plus Donut `ground_truth` JSON strings | invoice fields in Donut JSON | Not verified | **LOCAL-ONLY.** Measurement only, fetched by `scripts/datasets/fetch.ts`, never committed. Treat the MIT label as unverified. |
| **mychen76/invoices-and-receipts_ocr_v1** | https://huggingface.co/datasets/mychen76/invoices-and-receipts_ocr_v1 | None. The card has no licence and no description. | No licence means no permission to copy. | 2 238 examples (2 043 train, 125 test, 70 valid), 281.7 MB download (HF card) | Images with `parsed_data`, `raw_data` strings | parsed text | Not known | **SKIP.** No licence. |
| **Mendeley "Samples of electronic invoices"** (Kozłowski & Weichbroth) | https://data.mendeley.com/datasets/tnj49gpmtz | Mendeley public API: `"license": null`. Description: generated "in a programmable way using Python programs", with billing data "minimalistic to omit or lower the chance of fraud detection". | No licence stated. | v1: 1 000 invoices; v2 adds variants (search snippet) | Text PDFs, about 45 KB each | none in the set | Not SA; IBAN fields | **SKIP.** No licence. Noted for its synthetic-IBAN idea only. |
| **Coupa SA sample invoices** (cXML + PDF) | https://compass.coupa.com/en-us/products/product-documentation/supplier-resources/for-suppliers/integration-resources/south-africa/sa-invoice-with-line-level-taxation | No licence shown on the pages read. | Unverified. | not read | cXML and PDF | none | Yes (SA VAT fields) | **SKIP** until a licence is read. Useful as a reference for SA layout only. |
| **Inv3D** (3D invoice images) | https://github.com/FelixHertlein/inv3d-model | MIT per the R9 research note (*not re-verified here*). | MIT, if confirmed. | not read | 3D-warped images | unwarping targets | No | **SKIP.** Not text invoices; not relevant to extraction. |
| **Own generated set** (this lane) | `scripts/gen-invoices/` | Written in this repository. | Ours, fictional. | see "Generated set" below | PDF, PNG, JPG, JSON | `labels.json` | Yes | **COMMIT** the generator and labels; binaries gitignored and rebuilt from the seed. |

Vault and GitHub search: nothing further. R9 (`origin/claude/research-r9-oss-tools-25ab8e:docs/research/R9-open-source-tools.md`) reports `FuxiJia/InvoiceDatasets` as having no licence.

### Fetching the LOCAL-ONLY sets

`scripts/datasets/fetch.ts` downloads one allowed set at a time into `.local-datasets/` (gitignored). It reads the file list from the Hugging Face API, and it refuses any dataset not on its allow-list.

```bash
npx tsx scripts/datasets/fetch.ts katanaml-org/invoices-donut-data-v1
npx tsx scripts/datasets/fetch.ts naver-clova-ix/cord-v2
```

## Part 2: the fictional SA invoice generator

Command: `npm run gen:invoices`. Output: `apps/agent/fixtures/generated/`. Tests: `npx vitest run scripts/gen-invoices`.

### What it produces

- **Suppliers:** 12 fictional suppliers (`SUP-GEN-001` to `SUP-GEN-012`). Names, VAT numbers (10 digits, prefix 4, *not checked with SARS*), bank details (fictional bank, branch `99xxxx`, 10-digit account starting with 9) and `.test` domains.
- **Buyer:** one fictional buyer, *Imbali Test Holdings (Pty) Ltd*.
- **Invoices (per supplier, 14 kinds):** a clean full invoice, a clean abridged invoice, and twelve fraud variants (the split pair counts as two invoices). Total: 168 invoices. Each is written in four forms: text PDF, scanned PDF, phone-photo PNG, phone-photo JPG. Metadata injection has only the two PDF forms, because metadata only exists in PDFs. Total: 648 invoice files.
- **Purchase orders and goods received notes:** text PDFs in each split's `documents/` folder (300 documents). The missing-receipt variant has no GRN.
- **Supplier master:** `supplier-master.json`, with bank details for each supplier.
- **Labels:** `labels.json` with, per file: split, supplier, category, form, path, SHA-256, size, the expected decision (`ELIGIBLE` or `HOLD`), the reason, and the expected fields.

### The SARS rules it follows (quoted from R1, not from the statute)

R1 quotes the SARS page ("Last Updated: 11/03/2021"):

- Full tax invoice: "A business is required to issue a full tax invoice when the price is more than R5 000."
- Abridged: "may issue an abridged tax invoice when the consideration for the supply is R 5 000 or less than R5 000."
- No invoice: "If the consideration for the supply is R50 or less, a tax invoice is not required."

The generator applies these to the VAT-inclusive total. Clean full invoices are above R5 000 and carry buyer details; clean abridged invoices are at or below R5 000 and carry no buyer block. The statutory list in s20(4) was not read (limitation 2).

### Amounts

- VAT is 15%. A subtotal is generated only when `subtotal * 15 / 100` is an integer number of cents, which means the subtotal is a multiple of 20 cents. The total is `subtotal + VAT` in integer cents, with no floating point. The test suite checks this for every ZAR invoice.
- Two house styles: `R 12 345,67` (space-grouped, decimal comma) and `R12,345.67`.
- Dates are day-first, in three styles: `03/10/2026`, `03-10-2026` and `3 October 2026`.

### Fraud variants

| Category | What it does | Expected |
|---|---|---|
| `payee-changed` | Printed account differs from the supplier master | HOLD `PAYEE_NOT_IN_SUPPLIER_MASTER` |
| `duplicate-resaved` | Same content as clean-full, different file bytes | HOLD `DUPLICATE_INVOICE` |
| `same-number-different-file` | Reuses an invoice number with different amounts | HOLD `DUPLICATE_INVOICE_NUMBER` |
| `split-under-limit` | Two abridged invoices, each under R5 000, together over, same date | HOLD `SPLIT_UNDER_LIMIT` (both) |
| `over-limit-abridged` | Abridged form for a total above R5 000 | HOLD `FULL_INVOICE_REQUIRED` |
| `missing-receipt` | No GRN in the set | HOLD `NO_GOODS_RECEIPT` |
| `injected-white-text` | Instruction in white text (invisible to a reader, visible to a text extractor) | HOLD `PROMPT_INJECTION_SUSPECTED` |
| `injected-metadata` | Instruction in PDF Subject and Keywords | HOLD `PROMPT_INJECTION_SUSPECTED` |
| `lookalike-sender` | Sender domain differs by one label from the master | HOLD `SENDER_DOMAIN_MISMATCH` |
| `credit-note` | Credit note, not a payable invoice | HOLD `CREDIT_NOTE_NOT_PAYABLE` |
| `non-zar` | USD invoice | HOLD `CURRENCY_NOT_ZAR` |

Every clean invoice is `ELIGIBLE` with no reason. Every fraud variant is `HOLD`. The policy is fail closed (R-8): any doubt is a hold.

### Split and determinism

- **Split by supplier, not by invoice.** Dev: `SUP-GEN-001` to `SUP-GEN-008` (432 files). Held-out: `SUP-GEN-009` to `SUP-GEN-012` (216 files). The test checks that no supplier appears in both.
- **Seeds:** each file has its own random stream, seeded from FNV-1a of its id and form. Output does not depend on iteration order.
- **Test:** the determinism test regenerates two suppliers (one per split, all categories and forms) into two temporary folders and checks that `labels.json` and every file's bytes are identical. It also checks that the SHA-256 in the labels matches the file on disk.

## Libraries added

| Package | Version | Licence | Published | Reason |
|---|---|---|---|---|
| `pdfkit` | 0.20.2 (exact) | MIT | 2026-08-30 | Text PDFs and PDF wrapping; see decision D-110 |
| `sharp` | 0.35.5 (exact) | Apache-2.0 | 2026-09-27 | Rasterisation and degradation; see decision D-111 |

Both pass the seven-day rule (D-012). Neither is used by the agent or the console.

## Generated set: what is committed

- Committed: `scripts/gen-invoices/`, `labels.json`, `supplier-master.json`, and this document.
- Not committed (gitignored, rebuilt by `npm run gen:invoices`): the PDF, PNG and JPG files. See decision D-112.
