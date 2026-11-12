# Buyer records: the four CSV files and where they come from

Status: built and tested on synthetic files (`apps/agent/src/match/csv-import.ts`, tests in `apps/agent/test/match/csv-import.test.ts`).
**No integration with Xero, QuickBooks Online or Odoo exists.** The buyer exports four CSV files from its own system,
or fills them in by hand, and SignOff reads those files. The column mapping below is a plan for that export. It is
**UNVERIFIED** against real exports from any of the three products, because no sample export was available in this work.

## The four files

Columns are matched by name after lower-casing, trimming, and turning spaces or hyphens into underscores. A missing or
unexpected column stops the import. Every row is checked; all errors are reported with the file name and line number,
and nothing is imported until every file is clean.

| File | Columns | Notes |
|---|---|---|
| `suppliers.csv` | `supplier_id`, `legal_name`, `enrolled_payee_as_printed`, `status` | `status` is `approved`, `pending` or `suspended`. A blank `enrolled_payee_as_printed` means no account is enrolled. Each supplier ID may appear once. |
| `purchase_orders.csv` | `purchase_order_id`, `supplier_id`, `currency`, `amount`, `status` | `status` is `open` or `closed`; blank means open. Amounts are decimal text (`12345.67`); no thousands-separator guessing beyond commas, and at most two decimal places for ZAR, USD and ZMW. |
| `goods_received.csv` | `purchase_order_id`, `received_amount`, `received_at` | One row per delivery. Rows for the same order are **added together**, so the receipt is cumulative. `received_at` is an ISO instant. |
| `payment_history.csv` | `supplier_id`, `invoice_number`, `invoice_date`, `currency`, `amount`, `purchase_order_id`, `payee_account`, `state` | `state` is `paid`, `open` or `void`. `void` rows are ignored. Paid and open rows against an order count toward its invoiced value. |

Currencies are the four the agent supports (ZAR, USD, ZMW, EUR, GBP); see `packages/shared/src/money/minor-units.ts`.

## Reading the files

- The name check is not a payee check. A supplier name is normalised (legal-form words such as `(Pty) Ltd` are dropped)
  only to choose a candidate. The printed account against the enrolled account decides who is paid.
- Two suppliers whose names normalise to the same key make the match ambiguous, and the invoice is held.
- A receipt that is short of the invoice by more than the tolerance holds; an order that is over-delivered by more than
  the tolerance holds for a person.

## Mapping from common exports (UNVERIFIED, to check against a real export)

These are the questions to answer with a real export. No column names below were read from a live file.

| SignOff file | Xero | QuickBooks Online | Odoo |
|---|---|---|---|
| `suppliers.csv` | Contacts (suppliers) export. Bank details are entered by hand in Xero; check whether the export carries them. | Vendors list. Bank details are usually not in the standard export; check the vendor record. | Partners (vendors). Bank accounts are a separate model (`res.partner.bank`); export it separately. |
| `purchase_orders.csv` | Purchase orders export, if the purchase-order feature is used; otherwise a manual list. | Purchase orders, if used; otherwise a manual list. | Purchase Orders (`purchase.order`) export. |
| `goods_received.csv` | Not native to Xero; needs a third-party add-on (R3 section 3). Manual list otherwise. | Not standard; check the product version. | Receipts / stock moves (`stock.move` or `stock.picking`) export, if the receiving app is used. |
| `payment_history.csv` | Bills (purchases) export with payment status. | Bills export, plus payments. | Vendor bills (`account.move`) export with payment state. |

Unknown: whether any of these exports include bank account numbers, and whether they are reliable for the enrolled payee.
The enrolled account must come from the buyer's verified supplier record, not from an export that could have been edited.

## What this does not do

- It does not call any ERP or accounting API.
- It does not check bank accounts with a bank (AVS). That needs a licensed provider and is not built.
- It does not validate that a PO or receipt is genuine. It validates the file's shape and internal consistency only.
