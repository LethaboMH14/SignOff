/**
 * Writes the labelled invoice set: the PDFs, the labels (with the source span of each field), the buyer's evidence
 * export and the supplier master. Run it with `npm run agent:build-set`. The output is deterministic, so running it
 * again gives the same bytes and the same fingerprints. Its output is committed, and a test checks that it still
 * matches the labels.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the generator writes its own fixture folder */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256OfBytes } from '../../../packages/shared/src/node.js';

import { writeTextPdf } from './lib/pdf-writer.js';
import {
  CASES,
  invoiceNumberOf,
  layoutOf,
  numberIndexOf,
  purchaseOrderOf,
  SUPPLIERS,
} from './labelled-spec.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/labelled/', import.meta.url));
const NOTICE =
  'FICTIONAL TEST DATA. No real supplier, bank account, invoice or person is represented.';
const GOODS_RECEIVED_AT = '2026-09-28T09:00:00.000Z';

/** Ids count up within each category, so the labels read as clean-01, messy-01 and so on. */
function caseIds(): string[] {
  const counters = new Map<string, number>();
  return CASES.map((spec) => {
    const next = (counters.get(spec.category) ?? 0) + 1;
    counters.set(spec.category, next);
    return `${spec.category}-${String(next).padStart(2, '0')}`;
  });
}

function main(): void {
  rmSync(join(FIXTURES, 'invoices'), { recursive: true, force: true });
  mkdirSync(join(FIXTURES, 'invoices'), { recursive: true });

  const ids = caseIds();
  const invoices: unknown[] = [];
  const purchaseOrders: unknown[] = [];
  const goodsReceipts: unknown[] = [];
  const cases: unknown[] = [];

  CASES.forEach((spec, index) => {
    const id = ids.at(index) ?? `case-${String(index + 1)}`;
    const omit = new Set<string>(spec.omit ?? []);
    const { lines, spans } = layoutOf(index);
    const bytes = writeTextPdf([lines]);
    writeFileSync(join(FIXTURES, 'invoices', `${id}.pdf`), bytes);

    // A duplicate reuses its original's numbers, so it adds an invoice record only. Every other case adds its own
    // purchase order and goods receipt. An over-limit case has a smaller order and receipt than its invoice total.
    const number = numberIndexOf(index);
    const invoiceNumber = invoiceNumberOf(number);
    const purchaseOrderId = purchaseOrderOf(number);
    invoices.push({
      fingerprint: sha256OfBytes(bytes),
      supplierId: spec.supplierId,
      invoiceNumber,
      currency: spec.currency,
      amountMinor: spec.totalMinor,
      purchaseOrderId,
      payeeAccountAsPrinted: spec.recordAccount,
    });
    if (spec.refersTo === undefined) {
      const orderMinor = spec.orderMinor ?? spec.totalMinor;
      purchaseOrders.push({
        purchaseOrderId,
        supplierId: spec.supplierId,
        currency: spec.currency,
        amountMinor: orderMinor,
      });
      goodsReceipts.push({
        purchaseOrderId,
        receivedMinor: orderMinor,
        receivedAt: GOODS_RECEIVED_AT,
      });
    }

    const supplier = SUPPLIERS.find((item) => item.supplierId === spec.supplierId);
    cases.push({
      id,
      category: spec.category,
      file: `invoices/${id}.pdf`,
      supplierId: spec.supplierId,
      expected: {
        decision: spec.expectedDecision,
        reason: spec.expectedReason,
        fields: {
          supplierName: supplier?.legalName ?? null,
          invoiceNumber: omit.has('invoiceNumber') ? null : invoiceNumber,
          invoiceDate: omit.has('invoiceDate') ? null : spec.isoDate,
          currency: spec.currency,
          totalMinor: omit.has('totalAsPrinted') ? null : spec.totalMinor,
          purchaseOrderNumber: omit.has('purchaseOrderNumber') ? null : purchaseOrderId,
          payeeAccountAsPrinted: spec.printedAccount,
        },
        spans,
      },
      note: spec.note,
    });
  });

  writeJson('labels.json', { notice: NOTICE, cases });
  writeJson('evidence.json', { schemaVersion: 1, invoices, purchaseOrders, goodsReceipts });
  writeJson('suppliers.json', {
    schemaVersion: 1,
    suppliers: SUPPLIERS.map((supplier) => ({
      supplierId: supplier.supplierId,
      legalName: supplier.legalName,
      enrolledPayeeAsPrinted: supplier.enrolledAccount,
      status: 'approved',
    })),
  });
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(FIXTURES, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main();
