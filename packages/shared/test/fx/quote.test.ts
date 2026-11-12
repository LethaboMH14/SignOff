import { describe, expect, it } from 'vitest';

import { parseRate, quoteRlusdPayoutInZar, RLUSD_ASSUMPTION } from '../../src/fx/quote.js';
import type { UsdZarRate } from '../../src/fx/quote.js';

const rate = (text: string, rateDate = '2026-11-10'): UsdZarRate => ({
  rate: text,
  rateDate,
  source: 'test rate',
  sourceKind: 'fixture',
  fallbackReason: null,
});

describe('quoteRlusdPayoutInZar', () => {
  it('converts one RLUSD at 16.3957 to R16.40 (known answer: 1639.57 cents rounds to 1640)', () => {
    const quote = quoteRlusdPayoutInZar(100, rate('16.3957'));
    expect(quote.zarMinor).toBe(1640);
    expect(quote.zarText).toBe('16.40');
    expect(quote.label).toBe('SIMULATED');
    expect(quote.deliveredRlusdMinor).toBe(100);
    expect(quote.rate).toBe('16.3957');
    expect(quote.rateDate).toBe('2026-11-10');
    expect(quote.source).toBe('test rate');
    expect(quote.sourceKind).toBe('fixture');
    expect(quote.fallbackReason).toBeNull();
    expect(quote.assumption).toBe(RLUSD_ASSUMPTION);
  });

  it('converts ten RLUSD at 16.3957 to R163.96 (known answer: 16395.7 cents rounds to 16396)', () => {
    const quote = quoteRlusdPayoutInZar(1000, rate('16.3957'));
    expect(quote.zarMinor).toBe(16396);
    expect(quote.zarText).toBe('163.96');
  });

  it('rounds half up at the cent: 3 cents at 0.5 is 1.5 cents, which becomes 2', () => {
    expect(quoteRlusdPayoutInZar(3, rate('0.5')).zarMinor).toBe(2);
    expect(quoteRlusdPayoutInZar(1, rate('0.5')).zarMinor).toBe(1);
  });

  it('rounds a 0.565 remainder up: 100 cents at 16.39565 is 1639.565 cents, which becomes 1640', () => {
    expect(quoteRlusdPayoutInZar(100, rate('16.39565')).zarMinor).toBe(1640);
  });

  it('keeps six decimal places exactly: 1,000,000 cents at 16.123456 is R161,234.56', () => {
    const quote = quoteRlusdPayoutInZar(1_000_000, rate('16.123456'));
    expect(quote.zarMinor).toBe(16_123_456);
    expect(quote.zarText).toBe('161,234.56');
  });

  it('gives zero rand for zero RLUSD, and one cent at a small rate rounds down to zero', () => {
    expect(quoteRlusdPayoutInZar(0, rate('16.3957')).zarMinor).toBe(0);
    expect(quoteRlusdPayoutInZar(1, rate('0.1')).zarMinor).toBe(0);
  });

  it('refuses an amount that is not a whole number of minor units, or is negative', () => {
    expect(() => quoteRlusdPayoutInZar(1.5, rate('16.3957'))).toThrow(RangeError);
    expect(() => quoteRlusdPayoutInZar(-1, rate('16.3957'))).toThrow(RangeError);
    expect(() => quoteRlusdPayoutInZar(Number.NaN, rate('16.3957'))).toThrow(RangeError);
  });

  it('refuses a rand result beyond the supported maximum', () => {
    expect(() => quoteRlusdPayoutInZar(1_000_000_000_000_000, rate('9999.999999'))).toThrow(
      RangeError,
    );
  });

  it('refuses a rate date that is not YYYY-MM-DD', () => {
    expect(() => quoteRlusdPayoutInZar(100, rate('16.3957', '2026-9-1'))).toThrow(RangeError);
  });
});

describe('parseRate', () => {
  it('reads exact integers at 10^-6, including whole numbers', () => {
    expect(parseRate('16.3957').scaled).toBe(16_395_700n);
    expect(parseRate('16').scaled).toBe(16_000_000n);
    expect(parseRate('0.000001').scaled).toBe(1n);
    expect(parseRate('9999.999999').scaled).toBe(9_999_999_999n);
  });

  it.each(['', '0', '0.0', '-1', '+1', '1e3', '16.1234567', ' 16', '16,39', '.5', '10000', 'abc'])(
    'refuses %j',
    (text) => {
      expect(() => parseRate(text)).toThrow(RangeError);
    },
  );
});
