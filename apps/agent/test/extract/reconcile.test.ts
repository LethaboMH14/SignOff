import { describe, expect, it } from 'vitest';

import type { InvoiceExtraction } from '../../../../packages/shared/src/schemas/invoice.js';
import { holdReasonsOf, verifyInvoice, type StatedAmounts } from '../../src/extract/verify.js';

/**
 * The VAT arithmetic in integer cents. The page lines are the document; each amount is quoted from it, so the check
 * depends on the figures and not on how the model happened to format them.
 */

type Amount = { readonly value: string; readonly quote: string } | null;

function build(
  total: string,
  extra: { subtotal?: Amount; vat?: Amount } = {},
): { extraction: InvoiceExtraction & StatedAmounts; pages: string[] } {
  const extraction: InvoiceExtraction & StatedAmounts = {
    schemaVersion: 1,
    supplierName: { value: 'Lumen Test Supplies', quote: 'Lumen Test Supplies' },
    invoiceNumber: { value: 'INV-1', quote: 'Invoice number: INV-1' },
    invoiceDate: { value: '2026-10-02', quote: 'Invoice date: 02/10/2026' },
    currency: { value: 'ZAR', quote: 'Currency: ZAR' },
    totalAsPrinted: { value: total, quote: `Total due: ${total}` },
    purchaseOrderNumber: { value: 'PO-1', quote: 'PO number: PO-1' },
    payeeAccountAsPrinted: null,
    ...(extra.subtotal === undefined ? {} : { subtotalAsPrinted: extra.subtotal }),
    ...(extra.vat === undefined ? {} : { vatAsPrinted: extra.vat }),
  };
  const lines = [
    'Lumen Test Supplies',
    'Invoice number: INV-1',
    'Invoice date: 02/10/2026',
    'Currency: ZAR',
    'PO number: PO-1',
  ];
  if (extra.subtotal) lines.push(extra.subtotal.quote);
  if (extra.vat) lines.push(extra.vat.quote);
  lines.push(`Total due: ${total}`);
  return { extraction, pages: [lines.join('\n')] };
}

const line = (label: string, value: string): { value: string; quote: string } => ({
  value,
  quote: `${label}: ${value}`,
});

describe('VAT arithmetic in integer cents', () => {
  it('reconciles when subtotal plus VAT equals the total', () => {
    const { extraction, pages } = build('1,150.00', {
      subtotal: line('Subtotal', '1000.00'),
      vat: line('VAT 15%', '150.00'),
    });
    const verified = verifyInvoice(extraction, pages);
    expect(verified.reconciliation).toEqual({ status: 'RECONCILED', reason: null });
    expect(holdReasonsOf(verified).filter((reason) => reason.startsWith('amounts:'))).toEqual([]);
  });

  it('reconciles a Subtotal and VAT written in South African form with a decimal comma', () => {
    const { extraction, pages } = build('1 150,00', {
      subtotal: line('Subtotal', '1 000,00'),
      vat: line('VAT 15%', '150,00'),
    });
    const verified = verifyInvoice(extraction, pages);
    expect(verified.total.value).toMatchObject({ canonical: '1150.00', minor: 115_000 });
    expect(verified.reconciliation.status).toBe('RECONCILED');
  });

  it('holds when subtotal plus VAT does not equal the total, by one cent', () => {
    const { extraction, pages } = build('1,150.01', {
      subtotal: line('Subtotal', '1000.00'),
      vat: line('VAT 15%', '150.00'),
    });
    const verified = verifyInvoice(extraction, pages);
    expect(verified.reconciliation).toEqual({
      status: 'NOT_RECONCILED',
      reason: 'SUBTOTAL_PLUS_VAT_NOT_TOTAL',
    });
    expect(holdReasonsOf(verified)).toContain('amounts:SUBTOTAL_PLUS_VAT_NOT_TOTAL');
  });

  it('holds a VAT line with no subtotal, because the arithmetic cannot be checked', () => {
    const { extraction, pages } = build('1,150.00', { vat: line('VAT 15%', '150.00') });
    const verified = verifyInvoice(extraction, pages);
    expect(verified.reconciliation).toEqual({
      status: 'INCOMPLETE',
      reason: 'SUBTOTAL_NOT_STATED',
    });
    expect(holdReasonsOf(verified)).toContain('amounts:SUBTOTAL_NOT_STATED');
  });

  it('accepts a subtotal that equals the total when no VAT is stated, and holds one that does not', () => {
    const same = build('500.00', { subtotal: line('Subtotal', '500.00') });
    expect(verifyInvoice(same.extraction, same.pages).reconciliation.status).toBe('RECONCILED');
    const differ = build('500.00', { subtotal: line('Subtotal', '450.00') });
    expect(verifyInvoice(differ.extraction, differ.pages).reconciliation).toEqual({
      status: 'NOT_RECONCILED',
      reason: 'SUBTOTAL_NOT_TOTAL',
    });
  });

  it('treats an invoice that states no subtotal and no VAT as not stated, with nothing to check', () => {
    const { extraction, pages } = build('500.00');
    const verified = verifyInvoice(extraction, pages);
    expect(verified.reconciliation).toEqual({ status: 'NOT_STATED', reason: null });
    expect(holdReasonsOf(verified).some((reason) => reason.startsWith('amounts:'))).toBe(false);
  });

  it('holds a stated VAT figure whose quote is not in the document', () => {
    const { extraction } = build('1,150.00', {
      subtotal: line('Subtotal', '1000.00'),
      vat: { value: '150.00', quote: 'VAT: 150.00' },
    });
    // The document has the subtotal and the total, but not the VAT quote the model gave.
    const pages = [
      [
        'Lumen Test Supplies',
        'Invoice number: INV-1',
        'Invoice date: 02/10/2026',
        'Currency: ZAR',
        'PO number: PO-1',
        'Subtotal: 1000.00',
        'Total due: 1,150.00',
      ].join('\n'),
    ];
    const verified = verifyInvoice(extraction, pages);
    expect(verified.reconciliation.status).toBe('UNVERIFIED');
    expect(holdReasonsOf(verified)).toContain('amounts:VAT_QUOTE_NOT_FOUND');
  });

  it('holds an amount whose quote holds two figures, because the figure meant is then unknown', () => {
    const extraction: InvoiceExtraction & StatedAmounts = {
      schemaVersion: 1,
      supplierName: { value: 'Lumen Test Supplies', quote: 'Lumen Test Supplies' },
      invoiceNumber: { value: 'INV-1', quote: 'Invoice number: INV-1' },
      invoiceDate: { value: '2026-10-02', quote: 'Invoice date: 02/10/2026' },
      currency: { value: 'ZAR', quote: 'Currency: ZAR' },
      totalAsPrinted: { value: '1150.00', quote: 'Total 1150.00 incl VAT 150.00' },
      purchaseOrderNumber: { value: 'PO-1', quote: 'PO number: PO-1' },
      payeeAccountAsPrinted: null,
    };
    const verified = verifyInvoice(extraction, [
      'Lumen Test Supplies\nInvoice number: INV-1\nInvoice date: 02/10/2026\nCurrency: ZAR\nPO number: PO-1\nTotal 1150.00 incl VAT 150.00',
    ]);
    expect(verified.total).toMatchObject({ status: 'AMBIGUOUS', reason: 'AMOUNT_QUOTE_AMBIGUOUS' });
  });
});
