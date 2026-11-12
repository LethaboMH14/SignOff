import { describe, expect, it } from 'vitest';

import type { InvoiceExtraction } from '../../../../packages/shared/src/schemas/invoice.js';
import { holdReasonsOf, verifyInvoice } from '../../src/extract/verify.js';

const LINES = [
  'Lumen Test Supplies (Pty) Ltd',
  'Invoice number: INV-TST-0100',
  'Invoice date: 05/11/2026',
  'Currency: ZAR',
  'Total due: 12345.67',
  'PO number: PO-TST-0001',
  'Bank account: FICT-ACC-1001',
];

const PAGES = [LINES.join('\n')];

type Sourced = { readonly value: string; readonly quote: string } | null;

function extraction(
  overrides: Partial<Record<keyof InvoiceExtraction, unknown>> = {},
): InvoiceExtraction {
  return {
    schemaVersion: 1,
    supplierName: {
      value: 'Lumen Test Supplies (Pty) Ltd',
      quote: 'Lumen Test Supplies (Pty) Ltd',
    },
    invoiceNumber: { value: 'INV-TST-0100', quote: 'Invoice number: INV-TST-0100' },
    invoiceDate: { value: '2026-11-05', quote: 'Invoice date: 05/11/2026' },
    currency: { value: 'ZAR', quote: 'Currency: ZAR' },
    totalAsPrinted: { value: '12345.67', quote: 'Total due: 12345.67' },
    purchaseOrderNumber: { value: 'PO-TST-0001', quote: 'PO number: PO-TST-0001' },
    payeeAccountAsPrinted: { value: 'FICT-ACC-1001', quote: 'Bank account: FICT-ACC-1001' },
    ...overrides,
  } as InvoiceExtraction;
}

function sourced(value: string, quote: string): Sourced {
  return { value, quote };
}

describe('verifyInvoice on a clean extraction', () => {
  it('marks every field exact, with the page and a quote hash', () => {
    const verified = verifyInvoice(extraction(), PAGES);
    expect(verified.supplierName).toMatchObject({
      status: 'EXACT',
      value: 'Lumen Test Supplies (Pty) Ltd',
      page: 1,
    });
    expect(verified.invoiceNumber).toMatchObject({ status: 'EXACT', value: 'INV-TST-0100' });
    expect(verified.invoiceDate).toMatchObject({ status: 'EXACT', value: '2026-11-05' });
    expect(verified.currency).toMatchObject({ status: 'EXACT', value: 'ZAR' });
    expect(verified.total).toMatchObject({
      status: 'EXACT',
      value: { printed: '12345.67', minor: 1234567 },
    });
    expect(verified.payeeAccountAsPrinted).toMatchObject({
      status: 'EXACT',
      value: 'FICT-ACC-1001',
    });
    expect(verified.total.quoteSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(holdReasonsOf(verified)).toEqual([]);
  });

  it('gives the same quote hash for the same quote, so the audit can match it', () => {
    const first = verifyInvoice(extraction(), PAGES).invoiceNumber.quoteSha256;
    const second = verifyInvoice(extraction(), PAGES).invoiceNumber.quoteSha256;
    expect(first).toBe(second);
  });
});

describe('verifyInvoice on quotes', () => {
  it('holds a quote that is not in the document', () => {
    const verified = verifyInvoice(
      extraction({ supplierName: sourced('Acme Other Ltd', 'Acme Other Ltd') }),
      PAGES,
    );
    expect(verified.supplierName).toMatchObject({
      status: 'AMBIGUOUS',
      reason: 'QUOTE_NOT_FOUND',
      value: null,
      page: null,
      quoteSha256: null,
    });
    expect(holdReasonsOf(verified)).toContain('supplierName:QUOTE_NOT_FOUND');
  });

  it('holds an empty quote as not found', () => {
    const verified = verifyInvoice(
      extraction({ invoiceNumber: sourced('INV-TST-0100', '   ') }),
      PAGES,
    );
    expect(verified.invoiceNumber.reason).toBe('QUOTE_NOT_FOUND');
  });

  it('holds a quote that appears on two pages, because the page is then unknown', () => {
    const verified = verifyInvoice(extraction(), [LINES.join('\n'), LINES.join('\n')]);
    expect(verified.invoiceNumber).toMatchObject({
      status: 'AMBIGUOUS',
      reason: 'QUOTE_AMBIGUOUS',
    });
  });

  it('places a quote on the page where it is found', () => {
    const verified = verifyInvoice(extraction(), ['cover sheet', LINES.join('\n')]);
    expect(verified.invoiceNumber.page).toBe(2);
  });

  it('holds a value that is not inside its quote', () => {
    const verified = verifyInvoice(
      extraction({ invoiceNumber: sourced('INV-TST-0999', 'Invoice number: INV-TST-0100') }),
      PAGES,
    );
    expect(verified.invoiceNumber).toMatchObject({
      status: 'AMBIGUOUS',
      reason: 'VALUE_NOT_IN_QUOTE',
    });
  });

  it('holds an empty value even when the quote is found', () => {
    const verified = verifyInvoice(
      extraction({ invoiceNumber: sourced('   ', 'Invoice number: INV-TST-0100') }),
      PAGES,
    );
    expect(verified.invoiceNumber.reason).toBe('VALUE_NOT_IN_QUOTE');
  });

  it('treats white space in quotes and values as insignificant', () => {
    const verified = verifyInvoice(
      extraction({ invoiceNumber: sourced(' INV-TST-0100 ', 'Invoice   number: INV-TST-0100') }),
      PAGES,
    );
    expect(verified.invoiceNumber).toMatchObject({ status: 'EXACT', value: 'INV-TST-0100' });
  });
});

describe('verifyInvoice on missing and optional fields', () => {
  it('reports a field the model did not state as missing, and holds it when required', () => {
    const verified = verifyInvoice(extraction({ purchaseOrderNumber: null }), PAGES);
    expect(verified.purchaseOrderNumber).toMatchObject({
      status: 'MISSING',
      reason: 'FIELD_NOT_STATED',
    });
    expect(holdReasonsOf(verified)).toEqual(['purchaseOrderNumber:FIELD_NOT_STATED']);
  });

  it('does not hold an invoice that states no printed account', () => {
    const verified = verifyInvoice(extraction({ payeeAccountAsPrinted: null }), PAGES);
    expect(verified.payeeAccountAsPrinted.status).toBe('MISSING');
    expect(holdReasonsOf(verified)).toEqual([]);
  });

  it('holds a printed account the model claimed but could not source', () => {
    const verified = verifyInvoice(
      extraction({
        payeeAccountAsPrinted: sourced('FICT-ACC-7777', 'Bank account: FICT-ACC-7777'),
      }),
      PAGES,
    );
    expect(verified.payeeAccountAsPrinted).toMatchObject({
      status: 'AMBIGUOUS',
      reason: 'QUOTE_NOT_FOUND',
    });
    expect(holdReasonsOf(verified)).toEqual(['payeeAccountAsPrinted:QUOTE_NOT_FOUND']);
  });

  it('holds every missing required field, in a fixed order', () => {
    const verified = verifyInvoice(
      extraction({
        supplierName: null,
        invoiceNumber: null,
        invoiceDate: null,
        currency: null,
        totalAsPrinted: null,
        purchaseOrderNumber: null,
      }),
      PAGES,
    );
    expect(holdReasonsOf(verified)).toEqual([
      'supplierName:FIELD_NOT_STATED',
      'invoiceNumber:FIELD_NOT_STATED',
      'invoiceDate:FIELD_NOT_STATED',
      'currency:FIELD_NOT_STATED',
      'total:FIELD_NOT_STATED',
      'purchaseOrderNumber:FIELD_NOT_STATED',
    ]);
  });

  it('holds a conflicting printed account, which is a stronger signal than a missing one', () => {
    const verified = verifyInvoice(
      extraction({
        payeeAccountAsPrinted: sourced('FICT-ACC-1001', 'Bank account: FICT-ACC-1001'),
      }),
      PAGES,
    );
    expect(verified.payeeAccountAsPrinted.status).toBe('EXACT');
  });
});

describe('verifyInvoice on dates', () => {
  const cases: readonly [string, string, string, string][] = [
    ['5 November 2026', '2026-11-05', 'EXACT', ''],
    ['November 5, 2026', '2026-11-05', 'EXACT', ''],
    ['05.11.2026', '2026-11-05', 'EXACT', ''],
    ['5th Nov 2026', '2026-11-05', 'EXACT', ''],
    ['2026-11-05', '2026-11-05', 'EXACT', ''],
    ['5th of Nov', '2026-11-05', 'AMBIGUOUS', 'DATE_FORMAT'],
    ['31/02/2026', '2026-02-28', 'AMBIGUOUS', 'DATE_FORMAT'],
    ['05/11/2026', '2026-05-11', 'CONFLICTING', 'DATE_CONFLICT'],
  ];

  it.each(cases)('reads the date in %j as %s', (dateText, value, status, reason) => {
    const quote = `Invoice date: ${dateText}`;
    const verified = verifyInvoice(extraction({ invoiceDate: sourced(value, quote) }), [
      `Invoice date: ${dateText}\n${LINES.join('\n')}`,
    ]);
    expect(verified.invoiceDate.status).toBe(status);
    expect(verified.invoiceDate.reason).toBe(reason === '' ? null : reason);
  });

  it('holds a quote with two different dates', () => {
    const quote = 'Invoice date: 05/11/2026 due 05/12/2026';
    const verified = verifyInvoice(extraction({ invoiceDate: sourced('2026-11-05', quote) }), [
      quote,
    ]);
    expect(verified.invoiceDate).toMatchObject({ status: 'AMBIGUOUS', reason: 'DATE_AMBIGUOUS' });
  });

  it('accepts a quote that repeats the same date', () => {
    const quote = 'Invoice date 05/11/2026 (dated 05/11/2026)';
    const verified = verifyInvoice(extraction({ invoiceDate: sourced('2026-11-05', quote) }), [
      quote,
    ]);
    expect(verified.invoiceDate.status).toBe('EXACT');
  });
});

describe('verifyInvoice on currency', () => {
  it('reads US$ as US dollars', () => {
    const quote = 'Currency: US$';
    const verified = verifyInvoice(extraction({ currency: sourced('USD', quote) }), [
      `${quote}\nTotal: US$ 1,250.00`,
    ]);
    expect(verified.currency).toMatchObject({ status: 'EXACT', value: 'USD' });
  });

  it('reads R before a number as rand', () => {
    const quote = 'Amount R 1 000';
    const verified = verifyInvoice(extraction({ currency: sourced('ZAR', quote) }), [quote]);
    expect(verified.currency).toMatchObject({ status: 'EXACT', value: 'ZAR' });
  });

  it('does not read a bare dollar sign, so the currency is not stated', () => {
    const verified = verifyInvoice(extraction({ currency: sourced('USD', 'Price $') }), [
      'Price $ 10',
    ]);
    expect(verified.currency).toMatchObject({ status: 'AMBIGUOUS', reason: 'CURRENCY_NOT_STATED' });
  });

  it('holds a currency that the quote contradicts', () => {
    const verified = verifyInvoice(extraction({ currency: sourced('USD', 'Currency: ZAR') }), [
      'Currency: ZAR',
    ]);
    expect(verified.currency).toMatchObject({ status: 'CONFLICTING', reason: 'CURRENCY_CONFLICT' });
  });

  it('holds a quote that names two currencies', () => {
    const verified = verifyInvoice(extraction({ currency: sourced('ZAR', 'ZAR or USD') }), [
      'ZAR or USD',
    ]);
    expect(verified.currency).toMatchObject({ status: 'AMBIGUOUS', reason: 'CURRENCY_AMBIGUOUS' });
  });

  it('holds the total when its currency is not verified', () => {
    const verified = verifyInvoice(extraction({ currency: sourced('ZAR', 'Currency: ZAR') }), [
      'Total due: 12345.67',
    ]);
    expect(verified.total).toMatchObject({ status: 'AMBIGUOUS', reason: 'CURRENCY_UNVERIFIED' });
  });

  it('holds the total as unverified when the currency is missing', () => {
    const verified = verifyInvoice(extraction({ currency: null }), PAGES);
    expect(verified.total).toMatchObject({ status: 'AMBIGUOUS', reason: 'CURRENCY_UNVERIFIED' });
  });
});

describe('verifyInvoice on amounts', () => {
  // The currency line is on the page, so the total's currency is verified and the amount rules are what is tested.
  const total = (value: string, quote: string, page = quote) =>
    verifyInvoice(extraction({ totalAsPrinted: sourced(value, quote) }), [`${page}\nCurrency: ZAR`])
      .total;

  it('reads a grouped amount with a dot decimal', () => {
    expect(total('12,345.67', 'Total due: 12,345.67', 'Total due: 12,345.67')).toMatchObject({
      status: 'EXACT',
      value: { printed: '12,345.67', minor: 1_234_567 },
    });
  });

  it('refuses a South African space-grouped amount with a decimal comma, as an amount-format hold', () => {
    expect(total('12 345,67', 'Total due: R 12 345,67', 'Total due: R 12 345,67')).toMatchObject({
      status: 'AMBIGUOUS',
      reason: 'AMOUNT_FORMAT',
    });
  });

  it('refuses a European amount with a decimal comma', () => {
    expect(total('12.345,67', 'Total: 12.345,67', 'Total: 12.345,67')).toMatchObject({
      reason: 'AMOUNT_FORMAT',
    });
  });

  it('refuses more decimal places than the currency has', () => {
    expect(total('10.555', 'Total due: 10.555', 'Total due: 10.555')).toMatchObject({
      reason: 'AMOUNT_FORMAT',
    });
  });

  it('refuses a zero amount, which cannot be paid', () => {
    expect(total('0.00', 'Total due: 0.00', 'Total due: 0.00')).toMatchObject({
      reason: 'AMOUNT_NOT_PAYABLE',
    });
  });

  it('refuses a quote with a second amount in it, such as a VAT figure', () => {
    expect(
      total('1,150.00', 'Total 1,150.00 incl VAT 150.00', 'Total 1,150.00 incl VAT 150.00'),
    ).toMatchObject({
      reason: 'AMOUNT_QUOTE_AMBIGUOUS',
    });
  });

  it('refuses an amount that is not inside its quote', () => {
    expect(total('99.00', 'Total due: 12345.67', 'Total due: 12345.67')).toMatchObject({
      reason: 'VALUE_NOT_IN_QUOTE',
    });
  });
});
