import { describe, expect, it } from 'vitest';

import { importBook, parseCsv, type CsvFiles } from '../../src/match/csv-import.js';

const SUPPLIERS = [
  'supplier_id,legal_name,enrolled_payee_as_printed,status',
  'SUP-TST001,"Lumen Test Supplies (Pty) Ltd",FICT-ACC-1001,approved',
  'SUP-TST002,Hollow Test Traders,,pending',
  '',
].join('\n');

const ORDERS = [
  'purchase_order_id,supplier_id,currency,amount,status',
  'PO-TST-0001,SUP-TST001,ZAR,12345.67,open',
  'PO-TST-0002,SUP-TST001,ZAR,1000.00,',
  'PO-TST-0003,SUP-TST001,ZAR,500.00,closed',
].join('\r\n');

const RECEIPTS = [
  'purchase_order_id,received_amount,received_at',
  'PO-TST-0001,6000.00,2026-11-03T08:00:00Z',
  'PO-TST-0001,6345.67,2026-11-06T08:00:00Z',
  'PO-TST-0002,1000.00,2026-11-04T08:00:00Z',
].join('\n');

const HISTORY = [
  'supplier_id,invoice_number,invoice_date,currency,amount,purchase_order_id,payee_account,state',
  'SUP-TST001,INV-OLD-1,2026-10-01,ZAR,400.00,PO-TST-0002,FICT-ACC-1001,paid',
  'SUP-TST001,INV-OLD-2,2026-10-02,ZAR,250.00,PO-TST-0002,FICT-ACC-1001,void',
  'SUP-TST001,INV-OLD-3,2026-10-05,ZAR,100.00,,FICT-ACC-1001,open',
].join('\n');

const GOOD: CsvFiles = {
  suppliers: SUPPLIERS,
  purchaseOrders: ORDERS,
  goodsReceived: RECEIPTS,
  paymentHistory: HISTORY,
};

describe('parseCsv', () => {
  it('reads quoted fields with commas, doubled quotes, CRLF and a byte-order mark', () => {
    const { rows } = parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('refuses a quoted field that is never closed', () => {
    expect(() => parseCsv('a,"b\n')).toThrow('a quoted field is not closed');
  });
});

describe('importBook on a valid set of four files', () => {
  it('imports suppliers, orders and receipts, and adds several receipts for one order together', () => {
    const result = importBook(GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { book } = result;
    expect(book.suppliers.map((supplier) => supplier.supplierId)).toEqual([
      'SUP-TST001',
      'SUP-TST002',
    ]);
    expect(book.suppliers[1]?.enrolledPayeeAsPrinted).toBeNull();
    const order = book.purchaseOrders.find((item) => item.purchaseOrderId === 'PO-TST-0001');
    expect(order?.amountMinor).toBe(1_234_567);
    expect(book.goodsReceipts.find((item) => item.purchaseOrderId === 'PO-TST-0001')).toMatchObject(
      {
        receivedMinor: 1_234_567,
        receivedAt: '2026-11-06T08:00:00Z',
      },
    );
  });

  it('marks an order closed when the file says so, and counts paid and open history against it', () => {
    const result = importBook(GOOD);
    if (!result.ok) throw new Error('the valid set must import');
    const byId = new Map(result.book.purchaseOrders.map((item) => [item.purchaseOrderId, item]));
    expect(byId.get('PO-TST-0003')?.status).toBe('closed');
    expect(byId.get('PO-TST-0002')?.status).toBe('open');
    // Only the paid 400.00 names PO-TST-0002; the open row names no order and the void row is ignored.
    expect(byId.get('PO-TST-0002')?.invoicedMinor).toBe(40_000);
    expect(result.book.history.map((row) => row.invoiceNumber)).toEqual(['INV-OLD-1', 'INV-OLD-3']);
  });
});

describe('importBook fails closed and lists every error', () => {
  it('stops on a bad amount, an unknown status, and an unknown column, naming file and line', () => {
    const result = importBook({
      ...GOOD,
      purchaseOrders: ORDERS.replace('12345.67', '12,345.678'),
      suppliers: SUPPLIERS.replace('approved', 'maybe'),
      paymentHistory: HISTORY.replace('payee_account', 'payee_acct'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const files = result.errors.map((error) => `${error.file}:${String(error.line)}`);
    expect(files).toEqual(
      expect.arrayContaining(['purchase_orders.csv:2', 'suppliers.csv:2', 'payment_history.csv:1']),
    );
  });

  it('refuses a receipt for an order that is not on the file', () => {
    const result = importBook({
      ...GOOD,
      goodsReceived: `${RECEIPTS}\nPO-NOPE,1.00,2026-11-06T08:00:00Z`,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'goods_received.csv', message: 'no purchase order PO-NOPE' }),
    );
  });

  it('refuses a supplier identifier that appears twice', () => {
    const result = importBook({ ...GOOD, suppliers: `${SUPPLIERS}\nSUP-TST001,Other,,approved` });
    expect(result.ok).toBe(false);
  });

  it('refuses an amount with more decimal places than the currency has', () => {
    const result = importBook({ ...GOOD, purchaseOrders: ORDERS.replace('1000.00', '1000.001') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('more than 2 decimal places');
  });

  it('refuses a file with a missing column', () => {
    const result = importBook({ ...GOOD, goodsReceived: 'purchase_order_id,received_amount\n' });
    expect(result.ok).toBe(false);
  });
});
