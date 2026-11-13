/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { watchedEvidenceRegister } from '../src/watched-evidence.js';

function fileWith(orders: readonly string[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    invoices: [],
    purchaseOrders: orders.map((purchaseOrderId) => ({
      purchaseOrderId,
      supplierId: 'SUP-ABCD1234',
      currency: 'ZAR',
      amountMinor: 2000,
    })),
    goodsReceipts: [],
  });
}

let dir = '';

afterEach(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true });
    dir = '';
  }
});

/** Writes the file and moves its modification time forward, so the change is seen even on a coarse clock. */
function write(path: string, text: string, secondsLater: number): void {
  writeFileSync(path, text);
  const when = new Date(Date.now() + secondsLater * 1000);
  utimesSync(path, when, when);
}

describe('the watched evidence register', () => {
  it('finds a record written after start-up, without a restart', () => {
    dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const path = join(dir, 'evidence.json');
    write(path, fileWith(['PO-1']), 0);
    const register = watchedEvidenceRegister(path);
    expect(register.purchaseOrder('PO-2')).toBeUndefined();

    write(path, fileWith(['PO-1', 'PO-2']), 5);
    expect(register.purchaseOrder('PO-2')?.amountMinor).toBe(2000);
  });

  it('keeps the last valid version when a later file cannot be read', () => {
    dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const path = join(dir, 'evidence.json');
    write(path, fileWith(['PO-1']), 0);
    const register = watchedEvidenceRegister(path);

    write(path, '{ not json', 5);
    expect(register.purchaseOrder('PO-1')?.purchaseOrderId).toBe('PO-1');
    expect(register.purchaseOrder('PO-9')).toBeUndefined();
  });

  it('refuses to start from a file that does not match the schema', () => {
    dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const path = join(dir, 'evidence.json');
    write(path, JSON.stringify({ schemaVersion: 2 }), 0);
    expect(() => watchedEvidenceRegister(path)).toThrow();
  });
});
