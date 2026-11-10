# Agent reliability: handling hallucination

**Planned design. Nothing here is built or measured yet.**

The design assumes the agents will sometimes hallucinate. The goal is that a hallucination can only cause a hold, never a wrong payment: *the agent can be wrong; it cannot be wrong with money.*

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

## 3. "I don't know" is allowed

- The prompt instructs the model to leave a field empty when the invoice does not clearly state it.
- An empty required field is a hold, with the reason shown to the operator.

## 4. Cross-checks the model cannot influence

- Amount matches the purchase order and goods-received record.
- Supplier matches an enrolled, credentialed supplier.
- Invoice number has not been paid before.

All of these records are held by Warden.

## 5. Two readers, compared

Extraction runs twice (or with two models) and the results are compared. Any field where they disagree is held. This stays within the brief's cap of three model calls per invoice.

## 6. The invoice is hostile input

- Invoice text is passed as data, clearly separated from instructions.
- Even a fooled model has no payment tool, no keys and no way to change supplier records.

## 7. Measurement

- A labelled test set of invoices: clean, messy, with hidden instructions, with missing fields.
- Scored per run: fields correct, fields invented, fields correctly left empty, and **wrong values that would have reached payment, which must be zero**.
- Compared with a single-prompt baseline before claiming an improvement, as the brief requires.
- Re-run after every prompt or model change; results published in the repository.

## Not covered

- An invoice that is internally consistent but fraudulent, such as overcharging that matches a wrong purchase order. That is a process problem, not a hallucination.
- Scanned or handwritten invoices. The demo is limited to text PDFs.
