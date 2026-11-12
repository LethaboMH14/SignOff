import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { evidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../../packages/shared/src/schemas/evidence.js';
import { parseSupplierMaster } from '../match/supplier-master.js';

import type { LabelledCase, LabelledSet } from './cases.js';

/**
 * Turns lane J's generated fixtures into the shape the evaluation reads, so the same pipeline and scorer can run on the
 * held-out split. It reads two sources and nothing else:
 *
 * - `labels.json` (committed): one entry per rendered file, with its SHA-256, form, split, expected decision and fields;
 * - the generator's seeded corpus (`buildCorpus`, lane J, `scripts/gen-invoices`): the invoices, purchase orders and
 *   goods receipts behind the labels. The corpus is rebuilt in memory and never written to disk.
 *
 * Rules that are not the pipeline's own, and so are stated here:
 * - Credit notes and other non-invoice documents keep their expected HOLD. They are not in the invoice ledger, so the
 *   matching step holds them for want of a record. They are not given special handling.
 * - A file's fingerprint is the SHA-256 in `labels.json`, which is the hash of the file as rendered. A file is matched to
 *   its invoice record by that hash, as in the labelled set.
 * - A goods receipt has quantities, not amounts. Its received value is the quantity times the purchase order line's unit
 *   price, matched by description. A receipt line with no matching PO line makes the receipt's value unknown, and the
 *   receipt is then left out, so the purchase order cannot be matched to it.
 * - Supplier ids are rewritten to the shared form (SUP- then letters and digits), because the generator uses hyphens.
 *
 * The output is validated with the shared evidence schema and the supplier-master schema before it is returned.
 */

/** The fields the generated labels carry, as the labelled-set schema names them. */
interface GeneratedLabel {
  readonly id: string;
  readonly split: 'dev' | 'heldout';
  readonly supplierId: string;
  readonly category: string;
  readonly form: string;
  readonly path: string;
  readonly sha256: string;
  readonly expected: {
    readonly decision: 'ELIGIBLE' | 'HOLD';
    readonly reason: string | null;
    readonly documentType: string;
    readonly fields: Readonly<Record<string, unknown>>;
  };
}

/** The generator's corpus, as far as this adapter reads it. */
export interface CorpusLike {
  readonly suppliers: readonly {
    readonly id: string;
    readonly name: string;
    readonly domain: string;
    readonly bank: { readonly accountNumber: string };
  }[];
  readonly invoices: readonly {
    readonly id: string;
    readonly supplierId: string;
    readonly invoiceNumber: string;
    readonly currency: string;
    readonly totalMinor: number;
    readonly poNumber: string;
    readonly payeeAccount: string;
  }[];
  readonly purchaseOrders: readonly {
    readonly poNumber: string;
    readonly supplierId: string;
    readonly issuedDate: string;
    readonly totalMinor: number;
    readonly lines: readonly { readonly description: string; readonly unitMinor: number }[];
  }[];
  readonly goodsReceivedNotes: readonly {
    readonly poNumber: string;
    readonly supplierId: string;
    readonly receivedDate: string;
    readonly lines: readonly { readonly description: string; readonly qtyReceived: number }[];
  }[];
}

/** The shared supplier id form: "SUP-" then letters and digits. "SUP-GEN-001" becomes "SUP-GEN001". */
export function sharedSupplierId(generated: string): string {
  return `SUP-${generated.replace(/^SUP-/, '').replace(/[^A-Za-z0-9]/g, '')}`;
}

const INVOICE_TYPES: ReadonlySet<string> = new Set(['TAX_INVOICE_FULL', 'TAX_INVOICE_ABRIDGED']);

function isoInstantOf(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** The received value of a goods receipt, or null when a line has no matching purchase order line. */
function receivedMinorOf(
  receipt: CorpusLike['goodsReceivedNotes'][number],
  po: CorpusLike['purchaseOrders'][number] | undefined,
): number | null {
  if (po === undefined) return null;
  let total = 0;
  for (const line of receipt.lines) {
    const match = po.lines.find((candidate) => candidate.description === line.description);
    if (match === undefined) return null;
    total += Math.round(line.qtyReceived * match.unitMinor);
  }
  return total;
}

/**
 * Builds the evaluation set for one split from the labels, the corpus and the supplier master. Pure: it reads the files it
 * is given and the corpus it is given, and writes nothing.
 */
export function generatedSetOf(input: {
  readonly dir: string;
  readonly split: 'dev' | 'heldout';
  readonly labels: { readonly notice: string; readonly files: readonly GeneratedLabel[] };
  readonly corpus: CorpusLike;
}): LabelledSet {
  const { corpus, split } = input;
  const byInvoiceId = new Map(corpus.invoices.map((invoice) => [invoice.id, invoice]));
  const poByNumber = new Map(corpus.purchaseOrders.map((po) => [po.poNumber, po]));
  const files = input.labels.files.filter((file) => file.split === split);

  const cases: LabelledCase[] = [];
  const invoices: EvidenceInvoice[] = [];
  for (const file of files) {
    const invoice = byInvoiceId.get(file.id.replace(/\.[a-z_]+$/, ''));
    const isInvoice = INVOICE_TYPES.has(file.expected.documentType);
    cases.push({
      id: file.id,
      category: file.category,
      file: file.path,
      supplierId: sharedSupplierId(file.supplierId),
      expected: {
        decision: file.expected.decision,
        reason: file.expected.reason,
        fields: {
          supplierName: stringOrNull(file.expected.fields['supplierName']),
          invoiceNumber: stringOrNull(file.expected.fields['invoiceNumber']),
          invoiceDate: stringOrNull(file.expected.fields['invoiceDate']),
          currency: stringOrNull(file.expected.fields['currency']),
          totalMinor: numberOrNull(file.expected.fields['totalMinor']),
          purchaseOrderNumber: stringOrNull(file.expected.fields['purchaseOrderNumber']),
          payeeAccountAsPrinted: stringOrNull(file.expected.fields['payeeAccountAsPrinted']),
        },
        spans: {
          supplierName: null,
          invoiceNumber: null,
          invoiceDate: null,
          currency: null,
          totalMinor: null,
          purchaseOrderNumber: null,
          payeeAccountAsPrinted: null,
        },
      },
    } as unknown as LabelledCase);
    if (isInvoice && invoice !== undefined) {
      invoices.push({
        fingerprint: file.sha256,
        supplierId: sharedSupplierId(invoice.supplierId),
        invoiceNumber: invoice.invoiceNumber,
        currency: invoice.currency,
        amountMinor: invoice.totalMinor,
        purchaseOrderId: invoice.poNumber.length > 0 ? invoice.poNumber : null,
        payeeAccountAsPrinted: invoice.payeeAccount,
      });
    }
  }

  const purchaseOrders = corpus.purchaseOrders.map((po) => {
    const invoiceCurrency = corpus.invoices.find(
      (invoice) => invoice.poNumber === po.poNumber,
    )?.currency;
    return {
      purchaseOrderId: po.poNumber,
      supplierId: sharedSupplierId(po.supplierId),
      currency: invoiceCurrency ?? 'ZAR',
      amountMinor: po.totalMinor,
    };
  });

  const goodsReceipts: { purchaseOrderId: string; receivedMinor: number; receivedAt: string }[] =
    [];
  for (const receipt of corpus.goodsReceivedNotes) {
    const received = receivedMinorOf(receipt, poByNumber.get(receipt.poNumber));
    if (received !== null) {
      goodsReceipts.push({
        purchaseOrderId: receipt.poNumber,
        receivedMinor: received,
        receivedAt: isoInstantOf(receipt.receivedDate),
      });
    }
  }

  // Validated with the shared schemas, so a malformed adapter output stops the run before a number is produced.
  const evidence = evidenceRegister(
    EvidenceFile.parse({
      schemaVersion: 1,
      invoices,
      purchaseOrders,
      goodsReceipts,
    }),
  );
  const mapped = mappedSuppliers(corpus);
  return {
    dir: input.dir,
    notice: input.labels.notice,
    cases,
    evidence,
    suppliers: parseSupplierMaster(mapped),
  };
}

interface EvidenceInvoice {
  fingerprint: string;
  supplierId: string;
  invoiceNumber: string;
  currency: string;
  amountMinor: number;
  purchaseOrderId: string | null;
  payeeAccountAsPrinted: string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * The supplier master in the shape the match step reads: each supplier's enrolled payee is the account number on its bank
 * record, and its legal name is the name the generator gives it.
 */
function mappedSuppliers(corpus: CorpusLike): { schemaVersion: 1; suppliers: unknown[] } {
  return {
    schemaVersion: 1,
    suppliers: corpus.suppliers.map((supplier) => ({
      supplierId: sharedSupplierId(supplier.id),
      legalName: supplier.name,
      enrolledPayeeAsPrinted: supplier.bank.accountNumber,
      status: 'approved',
    })),
  };
}

/** Reads the committed labels for one split, and builds the set with the corpus. */
export function loadGeneratedSet(
  root: string,
  split: 'dev' | 'heldout',
  corpus: CorpusLike,
): LabelledSet {
  const labels = JSON.parse(readFileSync(join(root, 'labels.json'), 'utf8')) as {
    notice: string;
    files: GeneratedLabel[];
  };
  return generatedSetOf({ dir: root, split, labels, corpus });
}
