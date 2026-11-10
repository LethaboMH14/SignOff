import { describe, expect, it } from 'vitest';

import { findPii, isSouthAfricanIdNumber, passesLuhn } from '../../src/logging/pii.js';

/** An independent Luhn implementation, so the check is not verified against itself. */
function referenceLuhnCheckDigit(base: string): string {
  for (let candidate = 0; candidate <= 9; candidate++) {
    const digits = Array.from(base + String(candidate), Number).reverse();
    const sum = digits.reduce((total, value, index) => {
      if (index % 2 === 0) return total + value;
      const doubled = value * 2;
      return total + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);
    if (sum % 10 === 0) return String(candidate);
  }
  throw new Error('no check digit found');
}

/** A thirteen-digit national ID: a twelve-digit base followed by its computed check digit. */
function idFrom(base: string): string {
  return base + referenceLuhnCheckDigit(base);
}

/** YYMMDD of 10 January 1980, then a serial, citizenship and the rest; the check digit is added. */
const VALID_BASE = '800101500908';

describe('passesLuhn', () => {
  it('accepts well-known valid numbers and rejects a changed digit', () => {
    expect(passesLuhn('79927398713')).toBe(true);
    expect(passesLuhn('4111111111111111')).toBe(true);
    expect(passesLuhn('4111111111111112')).toBe(false);
  });

  it('rejects empty input and anything that is not a digit', () => {
    expect(passesLuhn('')).toBe(false);
    expect(passesLuhn('4111-1111-1111-1111')).toBe(false);
  });
});

describe('isSouthAfricanIdNumber', () => {
  it('accepts a number with a valid birth date and check digit', () => {
    const id = idFrom(VALID_BASE);
    expect(id).toHaveLength(13);
    expect(isSouthAfricanIdNumber(id)).toBe(true);
  });

  it('rejects a changed check digit', () => {
    const correct = referenceLuhnCheckDigit(VALID_BASE);
    const wrong = String((Number(correct) + 1) % 10);
    expect(isSouthAfricanIdNumber(VALID_BASE + wrong)).toBe(false);
  });

  it('rejects impossible months and days', () => {
    expect(isSouthAfricanIdNumber(idFrom('801301500908'))).toBe(false);
    expect(isSouthAfricanIdNumber(idFrom('800132500908'))).toBe(false);
  });

  it('rejects anything that is not thirteen digits', () => {
    expect(isSouthAfricanIdNumber(VALID_BASE)).toBe(false);
    expect(isSouthAfricanIdNumber(idFrom(VALID_BASE) + '0')).toBe(false);
  });
});

describe('findPii', () => {
  it('finds email addresses, IBANs, phone numbers, national IDs and payment cards', () => {
    const text = [
      'contact jane.doe@example.com',
      'iban GB82WEST12345698765432',
      'call +27821234567',
      `id ${idFrom(VALID_BASE)}`,
      'card 4111111111111111',
    ].join('\n');

    expect(findPii(text).map((span) => span.kind)).toEqual([
      'email',
      'iban',
      'phone',
      'national-id',
      'payment-card',
    ]);
  });

  it('does not treat a thirteen-digit reference with a wrong check digit as a national ID or a card', () => {
    const wrong = String((Number(referenceLuhnCheckDigit(VALID_BASE)) + 1) % 10);
    expect(findPii(`reference ${VALID_BASE}${wrong}`)).toEqual([]);
  });

  it('leaves amounts, invoice numbers and lower-case hashes alone', () => {
    const hash = 'ab12'.repeat(16);
    expect(findPii(`Total 12,500.50 ZAR, invoice INV-2026-0001, digest ${hash}`)).toEqual([]);
  });
});
