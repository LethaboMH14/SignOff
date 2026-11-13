/* eslint-disable security/detect-non-literal-fs-filename -- each test works only inside its own temporary folder */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withdrawFromLocalWarden, withEvidenceLock } from './demo-invoice.js';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'evidence-lock-'));
  mkdirSync(join(dir, 'demo'));
  mkdirSync(join(dir, 'warden'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const FIRST = 'a'.repeat(64);
const SECOND = 'b'.repeat(64);

/** Two invoices, each with its own order and receipt, in the shape the Warden's evidence file takes. */
function twoInvoices(): unknown {
  const invoice = (fingerprint: string, order: string) => ({
    fingerprint,
    supplierId: 'SUP-TST001',
    invoiceNumber: `INV-${order}`,
    currency: 'USD',
    amountMinor: 120,
    purchaseOrderId: order,
    payeeAccountAsPrinted: null,
  });
  return {
    schemaVersion: 1,
    invoices: [invoice(FIRST, 'PO-1'), invoice(SECOND, 'PO-2')],
    purchaseOrders: [
      { purchaseOrderId: 'PO-1', supplierId: 'SUP-TST001', currency: 'USD', amountMinor: 120 },
      { purchaseOrderId: 'PO-2', supplierId: 'SUP-TST001', currency: 'USD', amountMinor: 120 },
    ],
    goodsReceipts: [
      { purchaseOrderId: 'PO-1', receivedMinor: 120, receivedAt: '2026-11-13T09:00:00.000Z' },
      { purchaseOrderId: 'PO-2', receivedMinor: 120, receivedAt: '2026-11-13T09:00:00.000Z' },
    ],
  };
}

describe('the evidence lock', () => {
  it('runs the work and leaves no lock behind', () => {
    expect(withEvidenceLock(dir, () => 42)).toBe(42);
    expect(existsSync(join(dir, 'demo', 'evidence.lock'))).toBe(false);
  });

  it('refuses, writing nothing, while another writer holds a fresh lock', () => {
    mkdirSync(join(dir, 'demo', 'evidence.lock'));
    let ran = false;
    expect(() => {
      withEvidenceLock(
        dir,
        () => {
          ran = true;
        },
        { waitMs: 100 },
      );
    }).toThrow('locked by another writer');
    expect(ran).toBe(false);
  });

  it('removes a stale lock left by a process that died, and then runs', () => {
    const lock = join(dir, 'demo', 'evidence.lock');
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    let ran = false;
    withEvidenceLock(dir, () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });
});

describe('withdrawing invoices from the local Warden', () => {
  it('removes only the named invoice with its order and receipt, and keeps the rest', () => {
    const path = join(dir, 'warden', 'evidence.json');
    writeFileSync(path, JSON.stringify(twoInvoices()));
    expect(withdrawFromLocalWarden(dir, new Set([FIRST]))).toBe(1);
    const left = JSON.parse(readFileSync(path, 'utf8')) as {
      invoices: { fingerprint: string }[];
      purchaseOrders: { purchaseOrderId: string }[];
      goodsReceipts: { purchaseOrderId: string }[];
    };
    expect(left.invoices.map((invoice) => invoice.fingerprint)).toEqual([SECOND]);
    expect(left.purchaseOrders.map((order) => order.purchaseOrderId)).toEqual(['PO-2']);
    expect(left.goodsReceipts.map((receipt) => receipt.purchaseOrderId)).toEqual(['PO-2']);
  });

  it('removes nothing when none of the named invoices is in the file', () => {
    const path = join(dir, 'warden', 'evidence.json');
    writeFileSync(path, JSON.stringify(twoInvoices()));
    expect(withdrawFromLocalWarden(dir, new Set(['c'.repeat(64)]))).toBe(0);
    const left = JSON.parse(readFileSync(path, 'utf8')) as { invoices: unknown[] };
    expect(left.invoices).toHaveLength(2);
  });
});
