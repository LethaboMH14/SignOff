import { describe, expect, it } from 'vitest';

import { normaliseInvoiceNumber, obligationKey } from '../src/obligation-key.js';

describe('obligationKey', () => {
  it('matches an independently computed digest (known-answer test)', () => {
    // sha256 of the canonical text [1,"SUP-ABC123","INV001"], computed with sha256sum.
    expect(obligationKey('SUP-ABC123', 'INV-001')).toBe(
      'aaf402ce52cab0b4a365a39d0cb53a19e75fc92fdaef4ef8b38436c89d95176e',
    );
  });

  it('produces 64 lower-case hex characters', () => {
    expect(obligationKey('SUP-ABC123', 'INV-001')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same key for case, spacing and punctuation differences in the invoice number', () => {
    const reference = obligationKey('SUP-ABC123', 'INV-001');
    expect(obligationKey('SUP-ABC123', 'inv-001')).toBe(reference);
    expect(obligationKey('SUP-ABC123', 'INV001')).toBe(reference);
    expect(obligationKey('SUP-ABC123', '  INV   -001 ')).toBe(reference);
  });

  it('gives the same key for full-width characters, which NFKC maps to plain ones', () => {
    expect(obligationKey('SUP-ABC123', 'ＩＮＶ－００１')).toBe(
      obligationKey('SUP-ABC123', 'INV-001'),
    );
  });

  it('keeps leading zeros, so INV-01 and INV-001 are different invoices', () => {
    expect(obligationKey('SUP-ABC123', 'INV-01')).not.toBe(obligationKey('SUP-ABC123', 'INV-001'));
  });

  it('separates suppliers, so the same invoice number under two suppliers is two payables', () => {
    expect(obligationKey('SUP-ABC123', 'INV-001')).not.toBe(obligationKey('SUP-XYZ789', 'INV-001'));
  });

  it('cannot be confused by values that contain the separator characters', () => {
    expect(obligationKey('SUP-A', 'B-C')).not.toBe(obligationKey('SUP-A-B', 'C'));
    expect(obligationKey('SUP-A', 'B","C')).not.toBe(obligationKey('SUP-A', 'B'));
  });

  it('takes only the supplier and the invoice number, so an amount cannot change the key', () => {
    expect(obligationKey.length).toBe(2);
  });
});

describe('normaliseInvoiceNumber', () => {
  it('keeps only letters and digits, upper-cased', () => {
    expect(normaliseInvoiceNumber('  inv   001 ')).toBe('INV001');
  });

  it('drops hyphens, slashes and other punctuation', () => {
    expect(normaliseInvoiceNumber('a-b/c.1')).toBe('ABC1');
  });

  it('keeps letters from other scripts', () => {
    expect(normaliseInvoiceNumber('фак-001')).toBe('ФАК001');
  });
});
