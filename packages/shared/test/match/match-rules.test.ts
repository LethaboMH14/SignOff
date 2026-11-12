import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MATCH_TOLERANCE,
  editDistance,
  receiptCovers,
  supplierNameKey,
  toleranceMinor,
  withinTolerance,
} from '../../src/match-rules.js';

const TOL = { absoluteMinor: 100, basisPoints: 100 };

describe('shared tolerance rule', () => {
  it('takes the larger of the absolute and the percentage allowance, rounded down', () => {
    expect(toleranceMinor(1_000, TOL)).toBe(100);
    expect(toleranceMinor(100_000, TOL)).toBe(1_000);
    expect(toleranceMinor(12_345, { absoluteMinor: 0, basisPoints: 100 })).toBe(123);
  });

  it('accepts a gap equal to the allowance and refuses one cent more, in either direction', () => {
    expect(withinTolerance(1_000_000, 1_010_000, TOL)).toBe(true);
    expect(withinTolerance(1_000_000, 1_010_001, TOL)).toBe(false);
    expect(withinTolerance(1_000_000, 990_000, TOL)).toBe(true);
    expect(withinTolerance(1_000_000, 989_999, TOL)).toBe(false);
  });

  it('lets goods received fall short of the invoice by no more than the allowance', () => {
    expect(receiptCovers(5_000_000, 4_950_000, TOL)).toBe(true);
    expect(receiptCovers(5_000_000, 4_949_999, TOL)).toBe(false);
    expect(receiptCovers(5_000_000, 5_000_000, { absoluteMinor: 0, basisPoints: 0 })).toBe(true);
    expect(receiptCovers(5_000_000, 4_999_999, { absoluteMinor: 0, basisPoints: 0 })).toBe(false);
  });

  it('defaults to the same allowance the Warden test and gate configurations use', () => {
    expect(DEFAULT_MATCH_TOLERANCE).toEqual({ absoluteMinor: 100, basisPoints: 100 });
  });
});

describe('supplier name key', () => {
  it('treats legal-form variants as the same name', () => {
    const key = supplierNameKey('Lumen Test Supplies (Pty) Ltd');
    expect(supplierNameKey('LUMEN TEST SUPPLIES PTY LTD')).toBe(key);
    expect(supplierNameKey('Lumen Test Supplies (Pty)Ltd.')).toBe(key);
    expect(supplierNameKey('Lumen Test Supplies Proprietary Limited')).toBe(key);
    expect(supplierNameKey('Lumen Test Supplies')).toBe(key);
  });

  it('keeps genuinely different names apart', () => {
    expect(supplierNameKey('Lumen Test Supplies Holdings')).not.toBe(
      supplierNameKey('Lumen Test Supplies'),
    );
  });
});

describe('edit distance on invoice numbers', () => {
  it('counts one substitution, insertion or deletion as one', () => {
    expect(editDistance('INV0100', 'INV0100')).toBe(0);
    expect(editDistance('INV0100', 'INV0109')).toBe(1);
    expect(editDistance('INV0100', 'INV01000')).toBe(1);
    expect(editDistance('INV0100', 'INV010')).toBe(1);
    expect(editDistance('INV0100', 'INV0300')).toBe(1);
    expect(editDistance('INV0100', 'INV0199')).toBe(2);
  });
});
