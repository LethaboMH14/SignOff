import { describe, expect, it } from 'vitest';

import {
  assertMinorUnits,
  formatMinor,
  MAX_MINOR_UNITS,
  minorToDecimal,
  minorUnitExponent,
  parseMoneyText,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../../src/money/minor-units.js';

describe('parseMoneyText: accepted amounts', () => {
  it.each<[string, SupportedCurrency, number]>([
    ['12,500.50', 'ZAR', 1250050],
    ['12500.5', 'ZAR', 1250050],
    ['12500', 'ZAR', 1250000],
    ['0.00', 'ZAR', 0],
    ['0.05', 'USD', 5],
    ['007.50', 'ZAR', 750],
    ['1,234', 'ZAR', 123400],
    [' 42.00 ', 'EUR', 4200],
    ['1,234,567.89', 'GBP', 123456789],
  ])('reads %j in %s as %i minor units', (text, currency, minor) => {
    expect(parseMoneyText(text, currency)).toEqual({ ok: true, minor });
  });
});

describe('parseMoneyText: rejected amounts are never guessed', () => {
  it.each<[string, SupportedCurrency]>([
    ['', 'ZAR'],
    ['-5', 'ZAR'],
    ['+5', 'ZAR'],
    ['1e3', 'ZAR'],
    ['12,50', 'ZAR'],
    ['1 234,50', 'ZAR'],
    ['1.234,50', 'ZAR'],
    ['R100', 'ZAR'],
    ['100.005', 'ZAR'],
    ['.50', 'ZAR'],
    ['5.', 'ZAR'],
    ['12,34.50', 'ZAR'],
    ['1.2.3', 'ZAR'],
    ['١٢', 'ZAR'],
    ['NaN', 'ZAR'],
  ])('rejects %j in %s with a reason', (text, currency) => {
    const result = parseMoneyText(text, currency);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('rejects an amount above the supported maximum', () => {
    expect(parseMoneyText('1000000000000001', 'ZAR')).toEqual({
      ok: false,
      reason: 'amount exceeds the supported maximum',
    });
  });
});

describe('formatting and decimal strings', () => {
  it('formats for people with grouping and the currency exponent', () => {
    expect(formatMinor(1250050, 'ZAR')).toBe('12,500.50');
    expect(formatMinor(0, 'ZAR')).toBe('0.00');
    expect(formatMinor(5, 'USD')).toBe('0.05');
    expect(formatMinor(100, 'USD')).toBe('1.00');
    expect(formatMinor(123456789, 'ZAR')).toBe('1,234,567.89');
    expect(formatMinor(100000, 'EUR')).toBe('1,000.00');
  });

  it('writes a plain decimal string with no grouping for ledger values', () => {
    expect(minorToDecimal(1250050, 'ZAR')).toBe('12500.50');
    expect(minorToDecimal(5, 'GBP')).toBe('0.05');
  });

  it('round-trips through the decimal string for representative values', () => {
    for (const minor of [0, 1, 5, 99, 100, 1234567, MAX_MINOR_UNITS]) {
      const parsed = parseMoneyText(minorToDecimal(minor, 'ZAR'), 'ZAR');
      expect(parsed).toEqual({ ok: true, minor });
    }
  });
});

describe('integer guard', () => {
  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_MINOR_UNITS + 1])(
    'refuses %s as an amount',
    (value) => {
      expect(() => {
        assertMinorUnits(value);
      }).toThrow(RangeError);
      expect(() => formatMinor(value, 'USD')).toThrow(RangeError);
    },
  );

  it('accepts zero and the maximum', () => {
    expect(() => {
      assertMinorUnits(0);
    }).not.toThrow();
    expect(() => {
      assertMinorUnits(MAX_MINOR_UNITS);
    }).not.toThrow();
  });

  it('gives every supported currency two decimal places', () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      expect(minorUnitExponent(currency)).toBe(2);
    }
  });
});
