import { describe, expect, it } from 'vitest';
import { withInvoiceRecord, type InvoiceRecordInput } from '../demo/records.js';
import { evidenceRegister } from '../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../packages/shared/src/schemas/evidence.js';

const empty = EvidenceFile.parse({
  schemaVersion: 1,
  invoices: [],
  purchaseOrders: [],
  goodsReceipts: [],
});
const input: InvoiceRecordInput = {
  fingerprint: 'a'.repeat(64),
  supplierId: 'SUP-TST001',
  invoiceNumber: 'INV-DEMO-1',
  currency: 'ZAR',
  amountMinor: 1600,
  purchaseOrderId: 'PO-DEMO-1',
  payeeAccountAsPrinted: 'FICT-ACC-1001',
  receivedAt: '2026-11-12T09:00:00.000Z',
};

describe('demo buyer records', () => {
  it('adds the invoice, its order and its receipt in the given currency, keeping what was there', () => {
    const once = withInvoiceRecord(empty, input);
    const twice = withInvoiceRecord(once, {
      ...input,
      fingerprint: 'b'.repeat(64),
      invoiceNumber: 'INV-DEMO-2',
    });
    expect(twice.invoices.map((i) => i.invoiceNumber)).toEqual(['INV-DEMO-1', 'INV-DEMO-2']);
    expect(twice.invoices[0]?.currency).toBe('ZAR');
    expect(twice.purchaseOrders).toHaveLength(2);
    expect(twice.goodsReceipts[1]).toMatchObject({
      purchaseOrderId: 'PO-DEMO-1',
      receivedMinor: 1600,
    });
  });

  it('the register finds the invoice by its fingerprint, and refuses a file that repeats one', () => {
    const once = withInvoiceRecord(empty, input);
    expect(evidenceRegister(once).invoice(input.fingerprint)?.invoiceNumber).toBe('INV-DEMO-1');
    expect(() => evidenceRegister(withInvoiceRecord(once, input))).toThrow(/repeats/);
  });
});
