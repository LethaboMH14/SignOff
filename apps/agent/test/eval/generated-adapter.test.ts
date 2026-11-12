import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildCorpus } from '../../../../scripts/gen-invoices/model.js';
import {
  generatedSetOf,
  loadGeneratedSet,
  sharedSupplierId,
  type CorpusLike,
} from '../../src/eval/generated-adapter.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function corpus(): CorpusLike {
  return {
    suppliers: [
      {
        id: 'SUP-GEN-001',
        name: 'Fyndra Logistics (Pty) Ltd',
        domain: 'fyn.supplier.test',
        bank: { accountNumber: '9767192524' },
      },
    ],
    invoices: [
      {
        id: 'SUP-GEN-001-clean-full-01',
        supplierId: 'SUP-GEN-001',
        invoiceNumber: 'FYN-2026-0001',
        currency: 'ZAR',
        totalMinor: 300000,
        poNumber: 'PO-FYN-2026-0001',
        payeeAccount: '9767192524',
      },
      {
        id: 'SUP-GEN-001-credit-note-01',
        supplierId: 'SUP-GEN-001',
        invoiceNumber: 'CN-2026-0001',
        currency: 'ZAR',
        totalMinor: 50000,
        poNumber: '',
        payeeAccount: '9767192524',
      },
    ],
    purchaseOrders: [
      {
        poNumber: 'PO-FYN-2026-0001',
        supplierId: 'SUP-GEN-001',
        issuedDate: '2026-10-01',
        totalMinor: 300000,
        lines: [
          { description: 'Freight', unitMinor: 10000 },
          { description: 'Storage', unitMinor: 5000 },
        ],
      },
    ],
    goodsReceivedNotes: [
      {
        poNumber: 'PO-FYN-2026-0001',
        supplierId: 'SUP-GEN-001',
        receivedDate: '2026-10-10',
        lines: [
          { description: 'Freight', qtyReceived: 20 },
          { description: 'Storage', qtyReceived: 4 },
        ],
      },
    ],
  };
}

function labels(): { notice: string; files: unknown[] } {
  return {
    notice: 'FICTIONAL TEST DATA. No real supplier is represented.',
    files: [
      {
        id: 'SUP-GEN-001-clean-full-01.photo_jpg',
        split: 'heldout',
        supplierId: 'SUP-GEN-001',
        category: 'clean-full',
        form: 'photo_jpg',
        path: 'heldout/invoices/SUP-GEN-001-clean-full-01.photo_jpg.jpg',
        sha256: SHA_A,
        expected: {
          decision: 'ELIGIBLE',
          reason: null,
          documentType: 'TAX_INVOICE_FULL',
          fields: {
            supplierName: 'Fyndra Logistics (Pty) Ltd',
            invoiceNumber: 'FYN-2026-0001',
            invoiceDate: '2026-10-13',
            currency: 'ZAR',
            totalMinor: 300000,
            purchaseOrderNumber: 'PO-FYN-2026-0001',
            payeeAccountAsPrinted: '9767192524',
          },
        },
      },
      {
        id: 'SUP-GEN-001-credit-note-01.scan_pdf',
        split: 'heldout',
        supplierId: 'SUP-GEN-001',
        category: 'credit-note',
        form: 'scan_pdf',
        path: 'heldout/invoices/SUP-GEN-001-credit-note-01.scan_pdf.pdf',
        sha256: SHA_B,
        expected: {
          decision: 'HOLD',
          reason: 'NOT_AN_INVOICE',
          documentType: 'CREDIT_NOTE',
          fields: {
            supplierName: 'Fyndra Logistics (Pty) Ltd',
            invoiceNumber: 'CN-2026-0001',
            currency: 'ZAR',
            totalMinor: 50000,
          },
        },
      },
      {
        id: 'SUP-GEN-001-clean-full-01.dev_only',
        split: 'dev',
        supplierId: 'SUP-GEN-001',
        category: 'clean-full',
        form: 'text_pdf',
        path: 'dev/invoices/SUP-GEN-001-clean-full-01.text_pdf.pdf',
        sha256: SHA_C,
        expected: {
          decision: 'ELIGIBLE',
          reason: null,
          documentType: 'TAX_INVOICE_FULL',
          fields: {},
        },
      },
    ],
  };
}

function build() {
  return generatedSetOf({
    dir: '/tmp/gen',
    split: 'heldout',
    labels: labels() as never,
    corpus: corpus(),
  });
}

describe('sharedSupplierId', () => {
  it('rewrites a generator id into the shared SUP- form', () => {
    expect(sharedSupplierId('SUP-GEN-001')).toBe('SUP-GEN001');
    expect(sharedSupplierId('SUP-ABC123')).toBe('SUP-ABC123');
  });
});

describe('generatedSetOf', () => {
  it('keeps only the requested split as cases', () => {
    const set = build();
    expect(set.cases.map((item) => item.id)).toEqual([
      'SUP-GEN-001-clean-full-01.photo_jpg',
      'SUP-GEN-001-credit-note-01.scan_pdf',
    ]);
  });

  it('keeps the expected HOLD of a credit note, and gives it no invoice record', () => {
    const set = build();
    const creditNote = set.cases.find((item) => item.id.includes('credit-note'));
    expect(creditNote?.expected.decision).toBe('HOLD');
    expect(set.evidence.invoice(SHA_B)).toBeUndefined();
  });

  it('matches each invoice file to its record by the SHA-256 in the labels', () => {
    const set = build();
    expect(set.evidence.invoice(SHA_A)).toMatchObject({
      invoiceNumber: 'FYN-2026-0001',
      supplierId: 'SUP-GEN001',
      amountMinor: 300000,
      purchaseOrderId: 'PO-FYN-2026-0001',
      payeeAccountAsPrinted: '9767192524',
    });
  });

  it('values a goods receipt at quantity times the purchase order unit price, by description', () => {
    const set = build();
    expect(set.evidence.goodsReceipt('PO-FYN-2026-0001')?.receivedMinor).toBe(
      20 * 10000 + 4 * 5000,
    );
  });

  it('leaves out a receipt whose line has no matching purchase order line, rather than guessing its value', () => {
    const bad = corpus();
    const withBadLine: CorpusLike = {
      ...bad,
      goodsReceivedNotes: [
        {
          poNumber: 'PO-FYN-2026-0001',
          supplierId: 'SUP-GEN-001',
          receivedDate: '2026-10-10',
          lines: [{ description: 'Unknown', qtyReceived: 1 }],
        },
      ],
    };
    const set = generatedSetOf({
      dir: '/tmp/gen',
      split: 'heldout',
      labels: labels() as never,
      corpus: withBadLine,
    });
    expect(set.evidence.goodsReceipt('PO-FYN-2026-0001')).toBeUndefined();
  });

  it('gives the shared supplier id to suppliers, with the enrolled payee from the bank record', () => {
    const set = build();
    expect(set.suppliers).toEqual([
      expect.objectContaining({
        supplierId: 'SUP-GEN001',
        enrolledPayeeAsPrinted: '9767192524',
        status: 'approved',
      }),
    ]);
  });

  it('refuses output that does not match the shared evidence schema', () => {
    const broken = corpus();
    const invoices = [...broken.invoices];
    invoices[0] = { ...invoices[0]!, currency: 'NZD' };
    const brokenCorpus: CorpusLike = { ...broken, invoices };
    expect(() =>
      generatedSetOf({
        dir: '/tmp/gen',
        split: 'heldout',
        labels: labels() as never,
        corpus: brokenCorpus,
      }),
    ).toThrow();
  });
});

describe('the real generated corpus and committed labels', () => {
  const root = join(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    '..',
    'fixtures',
    'generated',
  );

  it('gives every held-out invoice label a matching invoice record, and no record for a credit note', () => {
    const labelJson = JSON.parse(readFileSync(join(root, 'labels.json'), 'utf8')) as {
      files: { split: string; sha256: string; expected: { documentType: string } }[];
    };
    const set = loadGeneratedSet(root, 'heldout', buildCorpus());
    expect(set.cases.length).toBe(
      labelJson.files.filter((file) => file.split === 'heldout').length,
    );
    const invoiceLabels = labelJson.files.filter(
      (file) => file.split === 'heldout' && file.expected.documentType !== 'CREDIT_NOTE',
    );
    for (const label of invoiceLabels) {
      expect(set.evidence.invoice(label.sha256)).not.toBeUndefined();
    }
  });
});
