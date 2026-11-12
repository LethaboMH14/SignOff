import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  screenInvoice,
  type ScreenCandidate,
  type ScreenOptions,
} from '../../src/match/fraud-screen.js';

const NOW = new Date('2026-11-12T10:00:00.000Z');
const OPTIONS: ScreenOptions = { now: NOW, splitThresholdMinor: 50_000_000 };
const FP = (n: number): string => n.toString(16).padStart(64, '0');

function invoice(overrides: Partial<ScreenCandidate> & { n: number }): ScreenCandidate {
  const { n, ...rest } = overrides;
  return {
    fingerprint: FP(n),
    supplierId: 'SUP-TST001',
    invoiceNumber: `INV-${String(n)}00`,
    amountMinor: 1_000_000,
    payeeAccountAsPrinted: 'FICT-ACC-1001',
    invoiceDate: '2026-11-05',
    ...rest,
  };
}

describe('date arithmetic', () => {
  it('counts whole calendar days and refuses an impossible date', () => {
    expect(daysBetween('2026-11-05', '2026-11-12')).toBe(7);
    expect(daysBetween('2026-11-12', '2026-11-05')).toBe(-7);
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNaN();
    expect(daysBetween('05/11/2026', '2026-11-12')).toBeNaN();
  });
});

describe('date holds', () => {
  it('holds an invoice dated in the future', () => {
    const result = screenInvoice(invoice({ n: 1, invoiceDate: '2026-12-01' }), [], OPTIONS);
    expect(result.holds).toEqual(['INVOICE_FUTURE_DATED']);
  });

  it('allows one day of clock difference, and holds more', () => {
    expect(screenInvoice(invoice({ n: 1, invoiceDate: '2026-11-13' }), [], OPTIONS).holds).toEqual(
      [],
    );
    expect(screenInvoice(invoice({ n: 1, invoiceDate: '2026-11-14' }), [], OPTIONS).holds).toEqual([
      'INVOICE_FUTURE_DATED',
    ]);
  });

  it('holds an invoice older than a year', () => {
    expect(screenInvoice(invoice({ n: 1, invoiceDate: '2025-10-01' }), [], OPTIONS).holds).toEqual([
      'INVOICE_TOO_OLD',
    ]);
  });

  it('holds a date that is not a real date, rather than guessing one', () => {
    expect(screenInvoice(invoice({ n: 1, invoiceDate: '2026-02-31' }), [], OPTIONS).holds).toEqual([
      'INVOICE_DATE_INVALID',
    ]);
  });
});

describe('the same payable under another file', () => {
  it('holds a re-saved file whose number and supplier match an earlier record, whatever its bytes', () => {
    const earlier = invoice({ n: 1 });
    // Different bytes (fingerprint), same supplier, and the same number once spacing and case go.
    const resaved = invoice({ n: 2, invoiceNumber: 'inv 100' });
    expect(screenInvoice(resaved, [earlier], OPTIONS).holds).toEqual(['DUPLICATE_RECORD']);
  });

  it('holds the same number with different content (a different amount) against the earlier record', () => {
    const earlier = invoice({ n: 1 });
    const revised = invoice({ n: 2, amountMinor: 1_250_000, invoiceNumber: earlier.invoiceNumber });
    expect(screenInvoice(revised, [earlier], OPTIONS).holds).toEqual(['DUPLICATE_RECORD']);
  });

  it('ignores its own record in the history', () => {
    const self = invoice({ n: 1 });
    expect(screenInvoice(self, [self], OPTIONS).holds).toEqual([]);
  });
});

describe('near duplicates', () => {
  it('holds a number one character away with the same amount inside the window', () => {
    const earlier = invoice({ n: 1, invoiceNumber: 'INV-TST-0100' });
    const near = invoice({ n: 2, invoiceNumber: 'INV-TST-0109', invoiceDate: '2026-11-10' });
    expect(screenInvoice(near, [earlier], OPTIONS).holds).toEqual(['NEAR_DUPLICATE']);
  });

  it('does not hold a number one character away when the amount is far off', () => {
    const earlier = invoice({ n: 1, invoiceNumber: 'INV-TST-0100' });
    const other = invoice({
      n: 2,
      invoiceNumber: 'INV-TST-0109',
      amountMinor: 9_000_000,
      invoiceDate: '2026-11-10',
    });
    expect(screenInvoice(other, [earlier], OPTIONS).holds).toEqual([]);
  });

  it('does not hold a near number outside the date window', () => {
    const earlier = invoice({ n: 1, invoiceNumber: 'INV-TST-0100', invoiceDate: '2026-06-01' });
    const near = invoice({ n: 2, invoiceNumber: 'INV-TST-0109', invoiceDate: '2026-11-10' });
    expect(screenInvoice(near, [earlier], OPTIONS).holds).toEqual([]);
  });

  it('does not hold a short number that differs by one character, which may be sequential billing', () => {
    const earlier = invoice({ n: 1, invoiceNumber: 'A1' });
    const next = invoice({ n: 2, invoiceNumber: 'A2', invoiceDate: '2026-11-10' });
    expect(screenInvoice(next, [earlier], OPTIONS).holds).toEqual([]);
  });
});

describe('split invoices across days, by payee account', () => {
  it('holds two invoices to one account inside the window whose total is over the threshold', () => {
    const earlier = invoice({ n: 1, amountMinor: 3_000_000, invoiceDate: '2026-11-03' });
    const later = invoice({
      n: 2,
      invoiceNumber: 'SPLIT-B',
      amountMinor: 3_000_000,
      invoiceDate: '2026-11-10',
      payeeAccountAsPrinted: 'fict acc 1001',
    });
    expect(
      screenInvoice(later, [earlier], { ...OPTIONS, splitThresholdMinor: 5_000_000 }).holds,
    ).toEqual(['SPLIT_SUSPECTED']);
  });

  it('matches the payee account ignoring spacing and case, but not a different account', () => {
    const earlier = invoice({ n: 1, amountMinor: 3_000_000, invoiceDate: '2026-11-03' });
    const other = invoice({
      n: 2,
      invoiceNumber: 'SPLIT-B',
      amountMinor: 3_000_000,
      invoiceDate: '2026-11-10',
      payeeAccountAsPrinted: 'FICT-ACC-9999',
    });
    expect(
      screenInvoice(other, [earlier], { ...OPTIONS, splitThresholdMinor: 5_000_000 }).holds,
    ).toEqual([]);
  });

  it('does not count an account that was not printed', () => {
    const earlier = invoice({ n: 1, amountMinor: 3_000_000, payeeAccountAsPrinted: null });
    const later = invoice({
      n: 2,
      invoiceNumber: 'SPLIT-B',
      amountMinor: 3_000_000,
      invoiceDate: '2026-11-10',
      payeeAccountAsPrinted: null,
    });
    expect(
      screenInvoice(later, [earlier], { ...OPTIONS, splitThresholdMinor: 5_000_000 }).holds,
    ).toEqual([]);
  });

  it('does not hold an invoice whose window total stays within the threshold', () => {
    const earlier = invoice({ n: 1, amountMinor: 100_000, invoiceDate: '2026-11-03' });
    const later = invoice({
      n: 2,
      invoiceNumber: 'SPLIT-B',
      amountMinor: 100_000,
      invoiceDate: '2026-11-10',
    });
    expect(screenInvoice(later, [earlier], OPTIONS).holds).toEqual([]);
  });
});

describe('determinism', () => {
  it('gives the same holds whatever order the history arrives in', () => {
    const a = invoice({ n: 1, invoiceNumber: 'INV-TST-0100' });
    const b = invoice({ n: 3, invoiceNumber: 'INV-TST-0100' });
    const c = invoice({ n: 4, invoiceNumber: 'INV-TST-0109', invoiceDate: '2026-11-10' });
    const candidate = invoice({ n: 2, invoiceNumber: 'INV-TST-0100' });
    const forward = screenInvoice(candidate, [a, b, c], OPTIONS);
    const backward = screenInvoice(candidate, [c, b, a], OPTIONS);
    expect(backward).toEqual(forward);
  });
});
