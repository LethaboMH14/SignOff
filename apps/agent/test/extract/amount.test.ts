import { describe, expect, it } from 'vitest';

import { amountTokensIn, canonicalAmount } from '../../src/extract/amount.js';

describe('canonicalAmount', () => {
  it.each([
    ['1234.50', '1234.50'],
    ['1234', '1234'],
    ['1,234.50', '1234.50'],
    ['12,500.00', '12500.00'],
    ['1.234,50', '1234.50'],
    ['1.234.567,89', '1234567.89'],
    ['1234,50', '1234.50'],
    ['12,50', '12.50'],
    ['1 234,50', '1234.50'],
    ['12 500.50', '12500.50'],
    ['12 500,50', '12500.50'],
    ['12 500,50', '12500.50'],
    ['1.234.567', '1234567'],
    ['R 12 500,50', '12500.50'],
    ['R12,500.50', '12500.50'],
    ['ZAR 1234.50', '1234.50'],
    ['1234.50 ZAR', '1234.50'],
    ['US$ 99.99', '99.99'],
    ['€ 10,00', '10.00'],
    ['£ 1,000.00', '1000.00'],
    ['  1234.5  ', '1234.5'],
  ])('reads %j as %j', (text, canonical) => {
    expect(canonicalAmount(text)).toEqual({ ok: true, canonical });
  });

  it.each([
    // Ambiguous: three digits after one separator may be thousands or decimals.
    ['1,234', 'AMOUNT_AMBIGUOUS'],
    ['1.234', 'AMOUNT_AMBIGUOUS'],
    ['1.234.56', 'AMOUNT_FORMAT'],
    ['12,500', 'AMOUNT_AMBIGUOUS'],
    ['1,234.567', 'AMOUNT_AMBIGUOUS'],
    // Format: not an amount this agent reads.
    ['12 50', 'AMOUNT_FORMAT'],
    ['1 23 456,00', 'AMOUNT_FORMAT'],
    ['-12.50', 'AMOUNT_FORMAT'],
    ['12.5.0', 'AMOUNT_FORMAT'],
    ['1234.505', 'AMOUNT_AMBIGUOUS'],
    ['$12.50', 'AMOUNT_FORMAT'],
    ['12.50 ZAR and VAT', 'AMOUNT_FORMAT'],
    ['', 'AMOUNT_FORMAT'],
    ['R', 'AMOUNT_FORMAT'],
    ['1e3', 'AMOUNT_FORMAT'],
  ])('refuses %j as %s', (text, reason) => {
    expect(canonicalAmount(text)).toEqual({ ok: false, reason });
  });
});

describe('amountTokensIn', () => {
  it('finds one amount in a quote that states one', () => {
    expect(amountTokensIn('Total due: 1 234,50')).toEqual(['1 234,50']);
  });

  it('finds two amounts when a quote holds a VAT figure as well', () => {
    expect(amountTokensIn('Total 1234.50 (VAT 195.00)')).toEqual(['1234.50', '195.00']);
  });

  it('finds no amount in a quote with none', () => {
    expect(amountTokensIn('Currency: ZAR')).toEqual([]);
  });
});
