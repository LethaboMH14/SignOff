import { describe, expect, it } from 'vitest';

import {
  dailyUsage,
  hold,
  limitVerdict,
  matchVerdict,
  preSigningVerdict,
  refuse,
  sastDay,
  scopedKeyOf,
  toleranceMinor,
} from '../src/checks.js';
import type { GoodsReceiptRecord, InvoiceRecord, PurchaseOrderRecord } from '../src/evidence.js';
import type { PreSigningFacts } from '../src/ledger-read.js';
import type { AttemptState, AttemptStatus, LimitsState } from '../src/state.js';

const DIGEST = 'ef'.repeat(32);
const SUPPLIER = 'SUP-ABCD1234';
const TOLERANCE = { absoluteMinor: 100, basisPoints: 100 };

function attemptWith(overrides: Partial<AttemptState>): AttemptState {
  return {
    attemptId: '6f1f2c1e-8b7a-4c55-9d3e-1a2b3c4d5e6f',
    scopedKey: DIGEST,
    obligationKey: DIGEST,
    invoiceFingerprint: DIGEST,
    supplierId: SUPPLIER,
    currency: 'USD',
    ledgerCurrency: 'TST',
    issuer: 'rIssuerIssuerIssuerIssuerIssu',
    amountMinor: 1000,
    attemptNumber: 1,
    lastLedgerSequence: 100,
    txFields: '{}',
    wardenBlob: 'AA',
    createdAt: '2026-11-10T10:00:00.000Z',
    status: 'paid',
    finalBlob: null,
    hash: null,
    ledgerIndex: null,
    engineResult: null,
    ...overrides,
  };
}

const INVOICE: InvoiceRecord = {
  fingerprint: DIGEST,
  supplierId: SUPPLIER,
  invoiceNumber: 'INV-001',
  currency: 'USD',
  amountMinor: 1000,
  purchaseOrderId: 'PO-001',
  payeeAccountAsPrinted: null,
};

const ORDER: PurchaseOrderRecord = {
  purchaseOrderId: 'PO-001',
  supplierId: SUPPLIER,
  currency: 'USD',
  amountMinor: 1000,
};

const RECEIPT: GoodsReceiptRecord = {
  purchaseOrderId: 'PO-001',
  receivedMinor: 1000,
  receivedAt: '2026-11-10T10:00:00.000Z',
};

function match(overrides: Partial<Parameters<typeof matchVerdict>[0]>) {
  return matchVerdict({
    supplierId: SUPPLIER,
    invoice: INVOICE,
    purchaseOrder: ORDER,
    receipt: RECEIPT,
    tolerance: TOLERANCE,
    ...overrides,
  });
}

const LIMITS: LimitsState = {
  revision: 1,
  policyVersion: '2026-11-10.1',
  perPaymentMinor: 1000,
  supplierDailyMinor: 2000,
  dailyTotalMinor: 3000,
};

const CLEAN_FACTS: PreSigningFacts = {
  spendingExists: true,
  masterDisabled: true,
  regularKeyPresent: false,
  signerListMatches: true,
  issuerGlobalFreeze: false,
  spendingLine: { balance: '100', limit: '1000', frozenByIssuer: false, frozenByHolder: false },
  destinationExists: true,
  destinationLine: { balance: '0', limit: '100', frozenByIssuer: false, frozenByHolder: false },
};

describe('day, identity and tolerance helpers', () => {
  it('counts the South African day, UTC+2, so a daily limit resets at 00:00 SAST', () => {
    expect(sastDay(new Date('2026-11-10T21:59:59.999Z'))).toBe('2026-11-10');
    expect(sastDay(new Date('2026-11-10T22:00:00.000Z'))).toBe('2026-11-11');
    expect(sastDay(new Date('2026-11-10T00:00:00.000Z'))).toBe('2026-11-10');
  });

  it('scopes the obligation to the buyer, so the same invoice under another buyer is a different payable', () => {
    const key = scopedKeyOf('buyer-test', DIGEST);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(scopedKeyOf('buyer-test', DIGEST)).toBe(key);
    expect(scopedKeyOf('buyer-other', DIGEST)).not.toBe(key);
  });

  it('allows the larger of the absolute and the percentage tolerance, rounded down', () => {
    expect(toleranceMinor(1000, TOLERANCE)).toBe(100);
    expect(toleranceMinor(100_000, TOLERANCE)).toBe(1000);
    expect(toleranceMinor(12_345, { absoluteMinor: 0, basisPoints: 100 })).toBe(123);
  });
});

describe('daily usage', () => {
  const day = '2026-11-10';
  const attempts = [
    attemptWith({ attemptId: 'a', status: 'paid', amountMinor: 100 }),
    attemptWith({ attemptId: 'b', status: 'awaiting', amountMinor: 200 }),
    attemptWith({ attemptId: 'c', status: 'submitting', amountMinor: 300 }),
    attemptWith({ attemptId: 'd', status: 'held', amountMinor: 400 }),
    attemptWith({ attemptId: 'e', status: 'failed', amountMinor: 500 }),
    attemptWith({ attemptId: 'f', status: 'rejected', amountMinor: 600 }),
    attemptWith({ attemptId: 'g', status: 'expired', amountMinor: 700 }),
    attemptWith({ attemptId: 'h', status: 'paid', amountMinor: 800, supplierId: 'SUP-ZZZZ9999' }),
    attemptWith({
      attemptId: 'i',
      status: 'paid',
      amountMinor: 900,
      createdAt: '2026-11-09T10:00:00.000Z',
    }),
  ];

  it('counts paid and unresolved attempts only, and only on the given day', () => {
    expect(dailyUsage(attempts, day, null)).toBe(100 + 200 + 300 + 400 + 800);
  });

  it('counts one supplier when a supplier is named', () => {
    expect(dailyUsage(attempts, day, SUPPLIER)).toBe(100 + 200 + 300 + 400);
    expect(dailyUsage(attempts, day, 'SUP-NONE0000')).toBe(0);
  });

  it('counts from an empty list as zero', () => {
    expect(dailyUsage([], day, null)).toBe(0);
  });
});

describe('the three-way match', () => {
  it('holds an invoice that names no purchase order, and one whose order is not in the register', () => {
    expect(match({ invoice: { ...INVOICE, purchaseOrderId: null } })).toMatchObject({
      decision: 'HOLD',
      code: 'MISSING_EVIDENCE',
    });
    expect(match({ purchaseOrder: undefined })).toMatchObject({
      decision: 'HOLD',
      code: 'MISSING_EVIDENCE',
    });
  });

  it('refuses a purchase order that belongs to another supplier', () => {
    expect(match({ purchaseOrder: { ...ORDER, supplierId: 'SUP-ZZZZ9999' } })).toMatchObject({
      decision: 'REFUSE',
      code: 'INVARIANT_FAILED',
    });
  });

  it('holds an invoice that differs from its order beyond the tolerance', () => {
    expect(match({ purchaseOrder: { ...ORDER, amountMinor: 2000 } })).toMatchObject({
      decision: 'HOLD',
      code: 'AMOUNT_MISMATCH',
    });
  });

  it('holds when no goods receipt exists, and when the goods received do not cover the invoice', () => {
    expect(match({ receipt: undefined })).toMatchObject({
      decision: 'HOLD',
      code: 'MISSING_EVIDENCE',
    });
    expect(match({ receipt: { ...RECEIPT, receivedMinor: 800 } })).toMatchObject({
      decision: 'HOLD',
      code: 'AMOUNT_MISMATCH',
    });
  });

  it('passes an exact match, and a match within tolerance', () => {
    expect(match({})).toBeNull();
    expect(
      match({
        purchaseOrder: { ...ORDER, amountMinor: 1005 },
        receipt: { ...RECEIPT, receivedMinor: 990 },
      }),
    ).toBeNull();
  });
});

describe('spending limits', () => {
  it('passes a payment within every limit, and one exactly at the per-payment limit', () => {
    expect(
      limitVerdict({ limits: LIMITS, amountMinor: 500, supplierToday: 0, totalToday: 0 }),
    ).toBeNull();
    expect(
      limitVerdict({ limits: LIMITS, amountMinor: 1000, supplierToday: 0, totalToday: 0 }),
    ).toBeNull();
  });

  it('holds a payment above the per-payment limit', () => {
    expect(
      limitVerdict({ limits: LIMITS, amountMinor: 1001, supplierToday: 0, totalToday: 0 }),
    ).toMatchObject({
      decision: 'HOLD',
      code: 'OVER_LIMIT',
    });
  });

  it('holds a payment that would take one supplier over the daily limit, and the daily total over its limit', () => {
    expect(
      limitVerdict({ limits: LIMITS, amountMinor: 500, supplierToday: 1501, totalToday: 1501 }),
    ).toMatchObject({
      code: 'OVER_LIMIT',
      message: 'the supplier daily limit would be exceeded',
    });
    expect(
      limitVerdict({ limits: LIMITS, amountMinor: 500, supplierToday: 0, totalToday: 2501 }),
    ).toMatchObject({
      code: 'OVER_LIMIT',
      message: 'the daily limit would be exceeded',
    });
  });

  it('allows a payment that lands exactly on the daily limits', () => {
    expect(
      limitVerdict({ limits: LIMITS, amountMinor: 500, supplierToday: 1500, totalToday: 2500 }),
    ).toBeNull();
  });
});

describe('the pre-signing ledger check', () => {
  it('passes when every fact is as expected', () => {
    expect(preSigningVerdict(CLEAN_FACTS, '10')).toBeNull();
  });

  it('holds when the spending account is missing from the ledger', () => {
    expect(preSigningVerdict({ ...CLEAN_FACTS, spendingExists: false }, '10')).toMatchObject({
      decision: 'HOLD',
      code: 'INVARIANT_FAILED',
    });
  });

  it('holds, and never signs, when the signer configuration differs from the approved one', () => {
    expect(preSigningVerdict({ ...CLEAN_FACTS, masterDisabled: false }, '10')).toMatchObject({
      decision: 'HOLD',
      code: 'SIGNER_CHANGE_NOT_APPROVED',
    });
    expect(preSigningVerdict({ ...CLEAN_FACTS, regularKeyPresent: true }, '10')).toMatchObject({
      code: 'SIGNER_CHANGE_NOT_APPROVED',
    });
    expect(preSigningVerdict({ ...CLEAN_FACTS, signerListMatches: false }, '10')).toMatchObject({
      code: 'SIGNER_CHANGE_NOT_APPROVED',
    });
  });

  it('holds when the issuer has frozen the asset, or the spending line is frozen by the issuer or the holder', () => {
    expect(preSigningVerdict({ ...CLEAN_FACTS, issuerGlobalFreeze: true }, '10')).toMatchObject({
      code: 'ACCOUNT_FROZEN',
    });
    expect(
      preSigningVerdict(
        {
          ...CLEAN_FACTS,
          spendingLine: { balance: '100', limit: '1000', frozenByIssuer: true, frozenByHolder: false },
        },
        '10',
      ),
    ).toMatchObject({ code: 'ACCOUNT_FROZEN' });
    expect(
      preSigningVerdict(
        {
          ...CLEAN_FACTS,
          spendingLine: { balance: '100', limit: '1000', frozenByIssuer: false, frozenByHolder: true },
        },
        '10',
      ),
    ).toMatchObject({ code: 'ACCOUNT_FROZEN' });
  });

  it('holds when the spending account does not hold the asset, or its balance is below the amount', () => {
    expect(preSigningVerdict({ ...CLEAN_FACTS, spendingLine: null }, '10')).toMatchObject({
      code: 'INVARIANT_FAILED',
    });
    expect(preSigningVerdict(CLEAN_FACTS, '100.01')).toMatchObject({
      decision: 'HOLD',
      code: 'INVARIANT_FAILED',
    });
    expect(preSigningVerdict(CLEAN_FACTS, '100')).toBeNull();
  });

  it('holds when the payee is missing, cannot hold the asset, or its line is frozen', () => {
    expect(preSigningVerdict({ ...CLEAN_FACTS, destinationExists: false }, '10')).toMatchObject({
      code: 'INVARIANT_FAILED',
    });
    expect(preSigningVerdict({ ...CLEAN_FACTS, destinationLine: null }, '10')).toMatchObject({
      code: 'INVARIANT_FAILED',
    });
    expect(
      preSigningVerdict(
        {
          ...CLEAN_FACTS,
          destinationLine: { balance: '0', limit: '100', frozenByIssuer: true, frozenByHolder: false },
        },
        '10',
      ),
    ).toMatchObject({ code: 'ACCOUNT_FROZEN' });
    expect(
      preSigningVerdict(
        {
          ...CLEAN_FACTS,
          destinationLine: { balance: '0', limit: '100', frozenByIssuer: false, frozenByHolder: true },
        },
        '10',
      ),
    ).toMatchObject({ code: 'ACCOUNT_FROZEN' });
  });
});

describe('B8 receiving capacity in issued-token trust lines', () => {
  const healthyLine = {
    balance: '95',
    limit: '100',
    frozenByIssuer: false,
    frozenByHolder: false,
  };

  it('accepts a payment that exactly fills the destination limit', () => {
    expect(preSigningVerdict({ ...CLEAN_FACTS, destinationLine: healthyLine }, '5')).toBeNull();
  });

  it('holds an amount over the remaining capacity, including fractional currency amounts', () => {
    expect(
      preSigningVerdict({ ...CLEAN_FACTS, destinationLine: healthyLine }, '5.01'),
    ).toMatchObject({ code: 'INVARIANT_FAILED' });
    expect(
      preSigningVerdict(
        {
          ...CLEAN_FACTS,
          destinationLine: { ...healthyLine, balance: '0.1', limit: '0.3' },
        },
        '0.200000000000001',
      ),
    ).toMatchObject({ code: 'INVARIANT_FAILED' });
    expect(
      preSigningVerdict(
        {
          ...CLEAN_FACTS,
          destinationLine: { ...healthyLine, balance: '0.1', limit: '0.3' },
        },
        '0.2',
      ),
    ).toBeNull();
  });

  it('fails closed when the receiving-limit metadata cannot be read as a decimal', () => {
    expect(
      preSigningVerdict(
        { ...CLEAN_FACTS, destinationLine: { ...healthyLine, limit: 'not-a-decimal' } },
        '1',
      ),
    ).toMatchObject({ code: 'INVARIANT_FAILED' });
  });
});

describe('verdict constructors', () => {
  it('build a HOLD and a REFUSE with their reason', () => {
    expect(hold('PAUSED', 'payments are paused')).toEqual({
      decision: 'HOLD',
      code: 'PAUSED',
      message: 'payments are paused',
    });
    expect(refuse('UNSUPPORTED_TRANSACTION', 'no asset')).toEqual({
      decision: 'REFUSE',
      code: 'UNSUPPORTED_TRANSACTION',
      message: 'no asset',
    });
  });

  it('keeps every status that is not a payment outcome out of the daily usage', () => {
    const statuses: AttemptStatus[] = ['failed', 'rejected', 'expired'];
    expect(
      dailyUsage(
        statuses.map((status) => attemptWith({ status })),
        '2026-11-10',
        null,
      ),
    ).toBe(0);
  });
});
