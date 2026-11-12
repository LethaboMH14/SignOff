import { describe, expect, it } from 'vitest';

import { evidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import { obligationKey } from '../../../../packages/shared/src/node.js';
import { EvidenceFile } from '../../../../packages/shared/src/schemas/evidence.js';
import { matchInvoice, type VerifiedValues } from '../../src/match/match.js';
import { parseSupplierMaster, type SupplierMaster } from '../../src/match/supplier-master.js';

/** Purchase-order and goods-receipt edge cases, and supplier name variants. The payee account always decides. */

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const SUPPLIER_ID = 'SUP-TST001';

interface Setup {
  readonly invoiceAmount?: number;
  readonly invoiceFingerprint?: string;
  readonly orderAmount?: number | null;
  readonly orderStatus?: 'open' | 'closed';
  readonly invoicedMinor?: number;
  readonly receipt?: number | null;
  readonly printedAccount?: string | null;
  readonly enrolledAccount?: string | null;
  readonly suppliers?: readonly SupplierMaster[];
  readonly printedName?: string;
  readonly invoiceNumber?: string;
  readonly alreadyPaid?: boolean;
}

function supplierList(enrolled: string | null, extra: SupplierMaster[] = []): SupplierMaster[] {
  return [
    ...parseSupplierMaster({
      schemaVersion: 1,
      suppliers: [
        {
          supplierId: SUPPLIER_ID,
          legalName: 'Lumen Test Supplies (Pty) Ltd',
          enrolledPayeeAsPrinted: enrolled,
          status: 'approved',
        },
      ],
    }),
    ...extra,
  ];
}

function run(setup: Setup = {}) {
  const amount = setup.invoiceAmount ?? 1_000_000;
  const fingerprint = setup.invoiceFingerprint ?? FP_A;
  const orderAmount = setup.orderAmount === undefined ? 1_000_000 : setup.orderAmount;
  const file = EvidenceFile.parse({
    schemaVersion: 1,
    invoices: [
      {
        fingerprint,
        supplierId: SUPPLIER_ID,
        invoiceNumber: setup.invoiceNumber ?? 'INV-TST-0100',
        currency: 'ZAR',
        amountMinor: amount,
        purchaseOrderId: 'PO-TST-0001',
        payeeAccountAsPrinted: setup.printedAccount ?? null,
      },
    ],
    purchaseOrders:
      orderAmount === null
        ? []
        : [
            {
              purchaseOrderId: 'PO-TST-0001',
              supplierId: SUPPLIER_ID,
              currency: 'ZAR',
              amountMinor: orderAmount,
              ...(setup.orderStatus === undefined ? {} : { status: setup.orderStatus }),
              ...(setup.invoicedMinor === undefined ? {} : { invoicedMinor: setup.invoicedMinor }),
            },
          ],
    goodsReceipts:
      setup.receipt === null || setup.receipt === undefined
        ? []
        : [
            {
              purchaseOrderId: 'PO-TST-0001',
              receivedMinor: setup.receipt,
              receivedAt: '2026-11-10T10:00:00.000Z',
            },
          ],
  });
  const values: VerifiedValues = {
    supplierName: setup.printedName ?? 'Lumen Test Supplies (Pty) Ltd',
    invoiceNumber: setup.invoiceNumber ?? 'INV-TST-0100',
    currency: 'ZAR',
    totalMinor: amount,
    purchaseOrderNumber: 'PO-TST-0001',
    payeeAccountAsPrinted: setup.printedAccount ?? null,
  };
  return matchInvoice({
    values,
    fingerprint,
    evidence: evidenceRegister(file),
    suppliers:
      setup.suppliers ??
      supplierList(setup.enrolledAccount === undefined ? 'FICT-ACC-1001' : setup.enrolledAccount),
    alreadyPaid: () => setup.alreadyPaid ?? false,
  });
}

function reasons(setup: Setup = {}): string[] {
  const result = run({ receipt: 1_000_000, ...setup });
  return result.ok ? [] : [...result.reasons];
}

describe('purchase order edge cases', () => {
  it('holds an invoice that names a purchase order the buyer does not hold', () => {
    expect(reasons({ orderAmount: null })).toEqual(expect.arrayContaining(['PO_NOT_FOUND']));
  });

  it('holds an invoice against a closed purchase order', () => {
    expect(reasons({ orderStatus: 'closed' })).toContain('PO_CLOSED');
  });

  it('holds an invoice that would take the order past its value, beyond tolerance', () => {
    expect(reasons({ invoicedMinor: 900_000, invoiceAmount: 200_000 })).toContain(
      'PO_FULLY_INVOICED',
    );
  });

  it('passes an invoice that takes the order over its value by no more than the tolerance', () => {
    // Order 1,000,000 with 1% tolerance (10,000): 900,000 + 100,500 is 500 over, inside the allowance.
    expect(reasons({ invoicedMinor: 900_000, invoiceAmount: 100_500 })).toEqual([]);
  });

  it('holds a price variance beyond tolerance, and passes one within it', () => {
    expect(reasons({ invoiceAmount: 1_020_000, receipt: 1_020_000 })).toContain(
      'AMOUNT_EXCEEDS_ORDER',
    );
    expect(reasons({ invoiceAmount: 1_005_000, receipt: 1_005_000 })).toEqual([]);
  });

  it('holds a partial delivery that does not cover the invoice beyond tolerance', () => {
    expect(reasons({ receipt: 500_000 })).toContain('AMOUNT_EXCEEDS_RECEIPT');
    expect(reasons({ receipt: 995_000 })).toEqual([]);
  });

  it('holds an over-delivery beyond the order, and not a delivery within tolerance of it', () => {
    expect(reasons({ receipt: 1_500_000 })).toContain('RECEIPT_EXCEEDS_ORDER');
    expect(reasons({ receipt: 1_005_000 })).toEqual([]);
  });
});

describe('supplier name variants: the name selects, the payee account decides', () => {
  it('matches a name written without or with other legal-form words', () => {
    expect(reasons({ printedName: 'LUMEN TEST SUPPLIES PTY LTD' })).toEqual([]);
    expect(reasons({ printedName: 'Lumen Test Supplies' })).toEqual([]);
  });

  it('holds a name variant whose printed account differs from the enrolled one', () => {
    expect(
      reasons({ printedName: 'Lumen Test Supplies Pty Ltd', printedAccount: 'FICT-ACC-9999' }),
    ).toContain('PAYEE_CHANGED');
  });

  it('holds a different supplier name, even when the account matches', () => {
    expect(reasons({ printedName: 'Lumen Test Supplies Holdings' })).toContain('SUPPLIER_UNKNOWN');
  });

  it('holds two suppliers whose names normalise to the same key', () => {
    const duplicate = supplierList('FICT-ACC-2002', [
      {
        supplierId: 'SUP-TST002',
        legalName: 'Lumen Test Supplies Pty Ltd',
        enrolledPayeeAsPrinted: 'FICT-ACC-2002',
        status: 'approved',
      },
    ]);
    expect(reasons({ suppliers: duplicate })).toEqual(['SUPPLIER_AMBIGUOUS']);
  });

  it('holds a printed account when the supplier has no enrolled account', () => {
    expect(reasons({ printedAccount: 'FICT-ACC-1001', enrolledAccount: null })).toContain(
      'PAYEE_NOT_ENROLLED',
    );
  });
});

describe('re-saved and revised invoices map to one payable', () => {
  it('gives a re-saved file, with different bytes but the same supplier and number, the same obligation', () => {
    const first = run({ invoiceFingerprint: FP_A, receipt: 1_000_000 });
    const second = run({ invoiceFingerprint: FP_B, receipt: 1_000_000 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.obligationKey).toBe(first.obligationKey);
    expect(second.obligationKey).toBe(obligationKey(SUPPLIER_ID, 'INV-TST-0100'));
  });

  it('holds the re-saved file as a duplicate once the payable has a payment', () => {
    expect(reasons({ invoiceFingerprint: FP_B, alreadyPaid: true })).toEqual(['DUPLICATE_PAYMENT']);
  });
});
