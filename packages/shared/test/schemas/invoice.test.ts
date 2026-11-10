import { describe, expect, it } from 'vitest';

import { InvoiceExtraction, validateInvoiceFields } from '../../src/schemas/invoice.js';
import { validInvoiceExtraction } from '../helpers/fixtures.js';

describe('InvoiceExtraction schema', () => {
  it('accepts a complete, sourced extraction', () => {
    expect(InvoiceExtraction.safeParse(validInvoiceExtraction()).success).toBe(true);
  });

  it('accepts an explicit null for a field the invoice does not state', () => {
    const extraction = validInvoiceExtraction();
    extraction.purchaseOrderNumber = null;
    expect(InvoiceExtraction.safeParse(extraction).success).toBe(true);
  });

  it('rejects an injected field, so a hidden payee cannot ride along', () => {
    const injected = { ...validInvoiceExtraction(), payTo: 'account-of-attacker' };
    expect(InvoiceExtraction.safeParse(injected).success).toBe(false);
  });

  it('rejects an amount typed as a number, because the model must never output one', () => {
    const extraction = { ...validInvoiceExtraction(), totalAsPrinted: 12500.5 };
    expect(InvoiceExtraction.safeParse(extraction).success).toBe(false);
  });

  it('rejects a value without the quote it came from', () => {
    const extraction = validInvoiceExtraction();
    extraction.supplierName = { value: 'Solar Supply Example Ltd' } as unknown as {
      value: string;
      quote: string;
    };
    expect(InvoiceExtraction.safeParse(extraction).success).toBe(false);
  });

  it('rejects a quote longer than the limit', () => {
    const extraction = validInvoiceExtraction();
    extraction.totalAsPrinted = { value: '1.00', quote: 'x'.repeat(501) };
    expect(InvoiceExtraction.safeParse(extraction).success).toBe(false);
  });

  it('rejects a currency outside the supported list', () => {
    const extraction = { ...validInvoiceExtraction(), currency: { value: 'XYZ', quote: 'XYZ' } };
    expect(InvoiceExtraction.safeParse(extraction).success).toBe(false);
  });

  it('rejects a date that is not a calendar date in ISO form', () => {
    const extraction = validInvoiceExtraction();
    extraction.invoiceDate = { value: '10/11/2026', quote: '10/11/2026' };
    expect(InvoiceExtraction.safeParse(extraction).success).toBe(false);
  });
});

describe('validateInvoiceFields', () => {
  it('turns a complete extraction into a validated invoice with an exact total', () => {
    const result = validateInvoiceFields(validInvoiceExtraction());
    expect(result).toEqual({
      ok: true,
      invoice: {
        supplierName: 'Solar Supply Example Ltd',
        invoiceNumber: 'INV-001',
        invoiceDate: '2026-11-10',
        currency: 'ZAR',
        totalMinor: 1250050,
        purchaseOrderNumber: 'PO-0042',
        payeeAccountAsPrinted: 'Account 0123456789',
      },
    });
  });

  it('omits optional fields that were not stated, rather than setting them to undefined', () => {
    const extraction = validInvoiceExtraction();
    extraction.purchaseOrderNumber = null;
    extraction.payeeAccountAsPrinted = null;
    const result = validateInvoiceFields(extraction);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('purchaseOrderNumber' in result.invoice).toBe(false);
      expect('payeeAccountAsPrinted' in result.invoice).toBe(false);
    }
  });

  it('holds and names every required field that is missing', () => {
    const extraction = validInvoiceExtraction();
    extraction.supplierName = null;
    extraction.currency = null;
    const result = validateInvoiceFields(extraction);
    expect(result).toEqual({
      ok: false,
      missing: ['supplierName', 'currency'],
      reasons: [],
    });
  });

  it('holds with a reason when the printed total cannot be read exactly', () => {
    const extraction = validInvoiceExtraction();
    extraction.totalAsPrinted = { value: '12,50', quote: 'Total: 12,50' };
    const result = validateInvoiceFields(extraction);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([]);
      expect(result.reasons[0]).toMatch(/^total: /);
    }
  });
});
