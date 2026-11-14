import { describe, expect, it } from 'vitest';

import {
  checkTaxInvoice,
  isSarsVatNumber,
  vatMinorOf,
  type TaxInvoiceFields,
} from '../../src/match/sars.js';

const ABRIDGED: TaxInvoiceFields = {
  documentKind: 'abridged',
  supplierName: 'Lumen Test Supplies (Pty) Ltd',
  supplierVatNumber: '4123456789',
  supplierAddress: null,
  buyerName: null,
  buyerVatNumber: null,
  invoiceNumber: 'INV-TST-0100',
  invoiceDate: '2026-11-05',
  description: 'Printer paper, 10 reams',
  subtotalMinor: null,
  vatMinor: null,
  totalMinor: 400_000,
  currency: 'ZAR',
};

const FULL: TaxInvoiceFields = {
  documentKind: 'full',
  supplierName: 'Lumen Test Supplies (Pty) Ltd',
  supplierVatNumber: '4123456789',
  supplierAddress: '1 Test Street, Testville',
  buyerName: 'Buyer Test (Pty) Ltd',
  buyerVatNumber: '4987654321',
  invoiceNumber: 'INV-TST-0200',
  invoiceDate: '2026-11-05',
  description: 'Office chairs',
  subtotalMinor: 1_000_000,
  vatMinor: 150_000,
  totalMinor: 1_150_000,
  currency: 'ZAR',
};

describe('VAT arithmetic in integer cents', () => {
  it('takes 15% of the subtotal, rounded half up, with no floating point', () => {
    expect(vatMinorOf(1_000_000)).toBe(150_000);
    expect(vatMinorOf(1)).toBe(0); // 0.15 cents rounds down
    expect(vatMinorOf(3)).toBe(0); // 0.45 cents
    expect(vatMinorOf(4)).toBe(1); // 0.60 cents rounds up
    expect(vatMinorOf(333_333)).toBe(50_000); // 49 999.95 cents rounds up
  });

  it('refuses a subtotal that is not a non-negative whole number of cents', () => {
    expect(() => vatMinorOf(-1)).toThrow(RangeError);
    expect(() => vatMinorOf(1.5)).toThrow(RangeError);
  });
});

describe('the R5 000 threshold', () => {
  it('accepts an abridged invoice at or below R5 000', () => {
    expect(checkTaxInvoice({ ...ABRIDGED, totalMinor: 500_000 })).toMatchObject({
      ok: true,
      requiresFull: false,
    });
  });

  it('requires a full invoice above R5 000, and holds an abridged one', () => {
    const result = checkTaxInvoice({ ...ABRIDGED, totalMinor: 500_001 });
    expect(result.requiresFull).toBe(true);
    expect(result.holds).toEqual(
      expect.arrayContaining([{ code: 'ABRIDGED_OVER_LIMIT' }, { code: 'FULL_INVOICE_REQUIRED' }]),
    );
  });

  it('uses the larger of the subtotal and the total, so a price just under the line is not split by VAT', () => {
    const result = checkTaxInvoice({
      ...ABRIDGED,
      documentKind: 'abridged',
      subtotalMinor: 480_000,
      vatMinor: 72_000,
      totalMinor: 552_000,
    });
    expect(result.requiresFull).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('accepts a complete full invoice above the threshold', () => {
    expect(checkTaxInvoice(FULL)).toEqual({ ok: true, holds: [], requiresFull: true });
  });
});

describe('mandatory fields', () => {
  it('holds an invoice missing a mandatory field, and names the field', () => {
    const result = checkTaxInvoice({ ...ABRIDGED, invoiceDate: null });
    expect(result.ok).toBe(false);
    expect(result.holds).toContainEqual({ code: 'MISSING_FIELD', field: 'invoiceDate' });
  });

  it('holds a full invoice missing the buyer VAT number or the subtotal', () => {
    const result = checkTaxInvoice({ ...FULL, buyerVatNumber: null, subtotalMinor: null });
    expect(result.holds).toEqual(
      expect.arrayContaining([
        { code: 'MISSING_FIELD', field: 'buyerVatNumber' },
        { code: 'MISSING_FIELD', field: 'subtotalMinor' },
      ]),
    );
  });

  it('holds a non-ZAR invoice for a person', () => {
    expect(checkTaxInvoice({ ...ABRIDGED, currency: 'USD' }).holds).toContainEqual({
      code: 'NOT_ZAR',
    });
  });
});

describe('supplier VAT number format', () => {
  it('accepts ten digits that begin with 4, with spaces or dashes ignored', () => {
    expect(isSarsVatNumber('4123456789')).toBe(true);
    expect(isSarsVatNumber('4 123-456 789')).toBe(true);
  });

  it('refuses any other shape', () => {
    expect(isSarsVatNumber('5123456789')).toBe(false);
    expect(isSarsVatNumber('412345678')).toBe(false);
    expect(isSarsVatNumber('41234567890')).toBe(false);
    expect(isSarsVatNumber('412345678A')).toBe(false);
  });

  it('holds an invoice whose supplier VAT number has the wrong shape', () => {
    expect(checkTaxInvoice({ ...ABRIDGED, supplierVatNumber: '5123456789' }).holds).toContainEqual({
      code: 'VAT_NUMBER_FORMAT',
      field: 'supplierVatNumber',
    });
  });
});

describe('VAT on the document', () => {
  it('passes when the printed VAT and total agree with the subtotal in cents', () => {
    expect(checkTaxInvoice(FULL).ok).toBe(true);
  });

  it('holds a printed VAT that is one cent out', () => {
    const result = checkTaxInvoice({ ...FULL, vatMinor: 150_001, totalMinor: 1_150_001 });
    expect(result.holds.map((hold) => hold.code)).toEqual(['VAT_ARITHMETIC']);
  });

  it('holds a total that is not subtotal plus VAT', () => {
    const result = checkTaxInvoice({ ...FULL, totalMinor: 1_150_100 });
    expect(result.holds.map((hold) => hold.code)).toEqual(['VAT_ARITHMETIC']);
  });
});
