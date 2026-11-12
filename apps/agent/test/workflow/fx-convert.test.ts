import { describe, expect, it } from 'vitest';

import { fixtureUsdZarRate } from '../../../../packages/shared/src/fx/index.js';
import { conversionOf, FxError, zarMinorToUsdMinor } from '../../src/workflow/fx-convert.js';

const rateOf = (rate: string, fallbackReason: string | null = null) => ({
  ...fixtureUsdZarRate(),
  rate,
  fallbackReason,
});

describe('ZAR to USD conversion for the Warden (known answers, integer arithmetic)', () => {
  it('R20.00 at 16.5 is USD 1.21 (121.2121 cents, rounded to 121)', () => {
    expect(zarMinorToUsdMinor(2000, rateOf('16.5'))).toBe(121);
  });

  it('R16.40 at 16.3957 is USD 1.00 (100.02 cents)', () => {
    expect(zarMinorToUsdMinor(1640, rateOf('16.3957'))).toBe(100);
  });

  it('rounds a tie half up: 1 cent at 2.000000 is 0.5 cent, which becomes 1 cent', () => {
    expect(zarMinorToUsdMinor(1, rateOf('2'))).toBe(1);
  });

  it('a rate with six decimals is exact: R100.00 at 16.123456', () => {
    // 10000 * 10^6 / 16123456 = 620.2... -> 620
    expect(zarMinorToUsdMinor(10000, rateOf('16.123456'))).toBe(620);
  });

  it('refuses a fixture rate used after a failed live request (never a stale default)', () => {
    expect(() => zarMinorToUsdMinor(2000, rateOf('16.5', 'live request failed'))).toThrow(FxError);
  });

  it('refuses a negative or fractional rand amount', () => {
    expect(() => zarMinorToUsdMinor(-1, rateOf('16.5'))).toThrow(FxError);
    expect(() => zarMinorToUsdMinor(1.5, rateOf('16.5'))).toThrow(FxError);
  });

  it('records the rate, its date and its source with the conversion', () => {
    const conversion = conversionOf(2000, rateOf('16.5'));
    expect(conversion).toMatchObject({ currency: 'USD', amountMinor: 121, rate: '16.5' });
    expect(conversion.source.length).toBeGreaterThan(0);
  });
});
