import { describe, expect, it } from 'vitest';
import {
  AmountError,
  assertPositiveIou,
  compareDecimal,
  normaliseDecimal,
  sameIouAmount,
} from '../src/amounts.js';

const CURRENCY = '524C555344000000000000000000000000000000';
const ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';

describe('normaliseDecimal', () => {
  it('returns the canonical form of plain decimals', () => {
    expect(normaliseDecimal('1')).toBe('1');
    expect(normaliseDecimal('1.50')).toBe('1.5');
    expect(normaliseDecimal('0.0')).toBe('0');
    expect(normaliseDecimal('0.25')).toBe('0.25');
    expect(normaliseDecimal('100.000')).toBe('100');
  });

  it('refuses anything that is not a plain non-negative decimal, rather than rounding it', () => {
    for (const value of ['-1', '+1', '1e3', '1,000', '01', '.5', '5.', '1 0', '', 'abc']) {
      expect(() => normaliseDecimal(value), value).toThrow(AmountError);
    }
  });

  it('refuses values with more than fifteen significant digits', () => {
    expect(normaliseDecimal('123456789012345')).toBe('123456789012345');
    expect(() => normaliseDecimal('1234567890123456')).toThrow('significant digits');
    expect(() => normaliseDecimal('0.0000000000000001')).not.toThrow();
  });
});

describe('assertPositiveIou', () => {
  it('normalises the value and refuses zero', () => {
    expect(assertPositiveIou({ currency: CURRENCY, issuer: ISSUER, value: '2.500' })).toEqual({
      currency: CURRENCY,
      issuer: ISSUER,
      value: '2.5',
    });
    expect(() => assertPositiveIou({ currency: CURRENCY, issuer: ISSUER, value: '0.00' })).toThrow(
      'greater than zero',
    );
  });
});

describe('sameIouAmount', () => {
  it('compares token, issuer and canonical value', () => {
    const a = { currency: CURRENCY, issuer: ISSUER, value: '1.5' };
    expect(sameIouAmount(a, { currency: CURRENCY, issuer: ISSUER, value: '1.50' })).toBe(true);
    expect(sameIouAmount(a, { currency: 'TST', issuer: ISSUER, value: '1.5' })).toBe(false);
    expect(sameIouAmount(a, { currency: CURRENCY, issuer: 'rOther', value: '1.5' })).toBe(false);
    expect(sameIouAmount(a, { currency: CURRENCY, issuer: ISSUER, value: '1.6' })).toBe(false);
  });

  it('never treats a malformed value as equal', () => {
    expect(
      sameIouAmount(
        { currency: CURRENCY, issuer: ISSUER, value: '1' },
        { currency: CURRENCY, issuer: ISSUER, value: '1e0' },
      ),
    ).toBe(false);
  });
});

describe('compareDecimal', () => {
  it('orders decimals numerically, not as text', () => {
    expect(compareDecimal('10', '9')).toBe(1);
    expect(compareDecimal('9', '10')).toBe(-1);
    expect(compareDecimal('0.5', '0.25')).toBe(1);
    expect(compareDecimal('0.25', '0.250')).toBe(0);
    expect(compareDecimal('1.2', '1.19')).toBe(1);
    expect(compareDecimal('0', '0.0001')).toBe(-1);
  });
});
