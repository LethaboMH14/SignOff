import { describe, expect, it } from 'vitest';

import { evidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../../packages/shared/src/schemas/evidence.js';
import {
  accountKey,
  matchInvoice,
  type MatchInput,
  type VerifiedValues,
} from '../../src/match/match.js';
import { parseSupplierMaster } from '../../src/match/supplier-master.js';
import { evidenceFile, FP, SUPPLIER_LIST } from '../support/world.js';

const VALUES: VerifiedValues = {
  supplierName: 'Lumen Test Supplies (Pty) Ltd',
  invoiceNumber: 'INV-TST-0100',
  currency: 'ZAR',
  totalMinor: 1_234_567,
  purchaseOrderNumber: 'PO-TST-0001',
  payeeAccountAsPrinted: 'FICT-ACC-1001',
};

function input(
  overrides: Partial<MatchInput> & { file?: Partial<ReturnType<typeof evidenceFile>> } = {},
): MatchInput {
  const { file, ...rest } = overrides;
  const base = evidenceFile();
  const evidence = evidenceRegister({ ...base, ...file });
  return {
    values: VALUES,
    fingerprint: FP,
    evidence,
    suppliers: SUPPLIER_LIST,
    alreadyPaid: () => false,
    ...rest,
  };
}

function reasonsOf(result: ReturnType<typeof matchInvoice>): string[] {
  return result.ok ? [] : [...result.reasons];
}

describe('matchInvoice on a consistent set of records', () => {
  it('matches the invoice to its supplier, purchase order and receipt', () => {
    const result = matchInvoice(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supplierId).toBe('SUP-TST001');
    expect(result.amountMinor).toBe(1_234_567);
    expect(result.obligationKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recordSha256s).toHaveLength(3);
  });

  it('gives the same obligation for the same supplier and invoice number, whatever the spacing', () => {
    const first = matchInvoice(input());
    const second = matchInvoice(input({ values: { ...VALUES, invoiceNumber: 'inv tst-0100' } }));
    expect(first.ok && second.ok && first.obligationKey === second.obligationKey).toBe(true);
  });
});

describe('matchInvoice holds each mismatch with its own reason', () => {
  it('holds an invoice with no record in the register', () => {
    const result = matchInvoice(input({ fingerprint: 'e'.repeat(64) }));
    expect(reasonsOf(result)).toEqual(['NO_INVOICE_RECORD']);
    expect(result.ok).toBe(false);
  });

  it('holds a supplier that is not on the master', () => {
    const result = matchInvoice(
      input({ values: { ...VALUES, supplierName: 'Other Test Supplies' } }),
    );
    expect(reasonsOf(result)).toEqual(['SUPPLIER_UNKNOWN']);
  });

  it('holds two suppliers with the same legal name as ambiguous', () => {
    const suppliers = parseSupplierMaster({
      schemaVersion: 1,
      suppliers: [
        {
          supplierId: 'SUP-TST001',
          legalName: 'Same Name',
          enrolledPayeeAsPrinted: null,
          status: 'approved',
        },
        {
          supplierId: 'SUP-TST002',
          legalName: 'same  name',
          enrolledPayeeAsPrinted: null,
          status: 'approved',
        },
      ],
    });
    const result = matchInvoice(
      input({ suppliers, values: { ...VALUES, supplierName: 'Same Name' } }),
    );
    expect(reasonsOf(result)).toEqual(['SUPPLIER_AMBIGUOUS']);
  });

  it('holds a supplier that is not approved', () => {
    const suppliers = parseSupplierMaster({
      schemaVersion: 1,
      suppliers: [
        {
          supplierId: 'SUP-TST001',
          legalName: 'Lumen Test Supplies (Pty) Ltd',
          enrolledPayeeAsPrinted: 'FICT-ACC-1001',
          status: 'pending',
        },
      ],
    });
    expect(reasonsOf(matchInvoice(input({ suppliers })))).toContain('SUPPLIER_NOT_APPROVED');
  });

  it('holds an invoice record that belongs to another supplier', () => {
    const file = evidenceFile();
    const moved = {
      ...file,
      invoices: file.invoices.map((invoice) => ({ ...invoice, supplierId: 'SUP-TST002' })),
    };
    expect(reasonsOf(matchInvoice(input({ file: moved })))).toContain('SUPPLIER_MISMATCH');
  });

  it('holds an invoice number that differs from the record', () => {
    expect(
      reasonsOf(matchInvoice(input({ values: { ...VALUES, invoiceNumber: 'INV-TST-0999' } }))),
    ).toContain('INVOICE_NUMBER_MISMATCH');
  });

  it('holds a currency that differs from the record', () => {
    expect(reasonsOf(matchInvoice(input({ values: { ...VALUES, currency: 'USD' } })))).toContain(
      'CURRENCY_MISMATCH',
    );
  });

  it('holds an amount that differs from the record', () => {
    expect(reasonsOf(matchInvoice(input({ values: { ...VALUES, totalMinor: 1 } })))).toContain(
      'AMOUNT_MISMATCH',
    );
  });

  it('holds a purchase order number that the record does not carry', () => {
    const file = evidenceFile();
    const cleared = {
      ...file,
      invoices: file.invoices.map((invoice) => ({ ...invoice, purchaseOrderId: null })),
    };
    expect(reasonsOf(matchInvoice(input({ file: cleared })))).toContain('PO_MISMATCH');
  });

  it('holds a purchase order that is not on record, and the rest of the checks still run', () => {
    const file = evidenceFile();
    const missing = { ...file, purchaseOrders: [], goodsReceipts: [] };
    const reasons = reasonsOf(matchInvoice(input({ file: missing })));
    expect(reasons).toEqual(expect.arrayContaining(['PO_NOT_FOUND', 'NO_GOODS_RECEIPT']));
  });

  it('holds a purchase order that belongs to another supplier or another currency', () => {
    const file = evidenceFile();
    const shifted = {
      ...file,
      purchaseOrders: file.purchaseOrders.map((order) => ({
        ...order,
        supplierId: 'SUP-TST002',
        currency: 'USD' as const,
      })),
    };
    expect(reasonsOf(matchInvoice(input({ file: shifted })))).toEqual(
      expect.arrayContaining(['PO_SUPPLIER_MISMATCH', 'PO_CURRENCY_MISMATCH']),
    );
  });

  it('holds an invoice that is larger than its purchase order', () => {
    const file = evidenceFile({ amountMinor: 2_000_000 });
    const bigger = {
      ...file,
      invoices: file.invoices.map((invoice) => ({ ...invoice, amountMinor: 2_000_000 })),
    };
    expect(
      reasonsOf(
        matchInvoice(input({ file: bigger, values: { ...VALUES, totalMinor: 2_000_000 } })),
      ),
    ).toContain('AMOUNT_EXCEEDS_ORDER');
  });

  it('holds an invoice that is larger than the goods received', () => {
    const file = evidenceFile({ receivedMinor: 1 });
    expect(reasonsOf(matchInvoice(input({ file })))).toContain('AMOUNT_EXCEEDS_RECEIPT');
  });

  it('holds a printed account that differs from the enrolled one, ignoring spacing and case', () => {
    expect(
      reasonsOf(
        matchInvoice(input({ values: { ...VALUES, payeeAccountAsPrinted: 'FICT-ACC-9999' } })),
      ),
    ).toContain('PAYEE_CHANGED');
    expect(
      reasonsOf(
        matchInvoice(input({ values: { ...VALUES, payeeAccountAsPrinted: 'fict acc 1001' } })),
      ),
    ).toEqual([]);
  });

  it('holds a printed account when the supplier has none enrolled', () => {
    const suppliers = parseSupplierMaster({
      schemaVersion: 1,
      suppliers: [
        {
          supplierId: 'SUP-TST001',
          legalName: 'Lumen Test Supplies (Pty) Ltd',
          enrolledPayeeAsPrinted: null,
          status: 'approved',
        },
      ],
    });
    expect(reasonsOf(matchInvoice(input({ suppliers })))).toContain('PAYEE_NOT_ENROLLED');
  });

  it('holds when the buyer record itself names a different account, even if the invoice does not', () => {
    const file = evidenceFile();
    const altered = {
      ...file,
      invoices: file.invoices.map((invoice) => ({
        ...invoice,
        payeeAccountAsPrinted: 'FICT-ACC-9999',
      })),
    };
    expect(
      reasonsOf(
        matchInvoice(input({ file: altered, values: { ...VALUES, payeeAccountAsPrinted: null } })),
      ),
    ).toContain('PAYEE_CHANGED');
  });

  it('holds a payable that may already be paid, and keeps the obligation for the record', () => {
    const result = matchInvoice(input({ alreadyPaid: () => true }));
    expect(reasonsOf(result)).toEqual(['DUPLICATE_PAYMENT']);
    expect(!result.ok && result.obligationKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives no obligation when the supplier was not found', () => {
    const result = matchInvoice(input({ values: { ...VALUES, supplierName: 'Nobody' } }));
    expect(!result.ok && result.obligationKey).toBeNull();
  });
});

describe('accountKey', () => {
  it('keeps letters and digits in upper case, and drops everything else', () => {
    expect(accountKey('fict-acc 1001')).toBe('FICTACC1001');
    expect(accountKey('ＡＢＣ 12')).toBe('ABC12');
  });
});

describe('supplier master', () => {
  it('refuses a supplier identifier that appears twice', () => {
    expect(() =>
      parseSupplierMaster({
        schemaVersion: 1,
        suppliers: [
          {
            supplierId: 'SUP-TST001',
            legalName: 'A',
            enrolledPayeeAsPrinted: null,
            status: 'approved',
          },
          {
            supplierId: 'SUP-TST001',
            legalName: 'B',
            enrolledPayeeAsPrinted: null,
            status: 'approved',
          },
        ],
      }),
    ).toThrow('the supplier master repeats a supplier identifier');
  });

  it('refuses an unknown field in a supplier record', () => {
    expect(() =>
      parseSupplierMaster({
        schemaVersion: 1,
        suppliers: [
          {
            supplierId: 'SUP-TST001',
            legalName: 'A',
            enrolledPayeeAsPrinted: null,
            status: 'approved',
            payTo: 'x',
          },
        ],
      }),
    ).toThrow();
  });

  it('is consistent with the shared evidence schema for the same fixture', () => {
    expect(EvidenceFile.parse(evidenceFile())).toBeDefined();
    expect(evidenceRegister(evidenceFile()).invoice(FP)).toBeDefined();
  });
});
