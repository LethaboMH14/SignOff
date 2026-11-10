/* eslint-disable security/detect-non-literal-fs-filename -- these tests write only into a temporary directory they create */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';

import type { LedgerPort, RegistryAccount } from '../../../packages/xrpl/src/index.js';
import { canonicalJson, fingerprintOf, sha256Hex } from '../src/canonical.js';
import { loadConfig, loadKeys, resolveConfig, type WardenConfigFile } from '../src/config.js';
import { evidenceRegister, loadEvidence, type EvidenceFile } from '../src/evidence.js';
import { simulatedIdentityChecker } from '../src/identity.js';
import { readPreSigning } from '../src/ledger-read.js';

const directory = mkdtempSync(join(tmpdir(), 'warden-support-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function writeJson(name: string, value: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe('canonical text and fingerprints', () => {
  it('sorts object keys at every depth, so equal values give equal text', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] })).toBe(
      '{"a":[{"y":2,"z":1}],"b":{"c":2,"d":1}}',
    );
  });

  it('keeps the order of arrays', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('writes a value that has no JSON form as null, so it can still be hashed', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('hashes text as SHA-256 and fingerprints a value by its canonical text', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(fingerprintOf({ b: 1, a: 2 })).toBe(sha256Hex('{"a":2,"b":1}'));
  });
});

const SUPPLIER_ID = 'SUP-ABCD1234';
const FINGERPRINT = sha256Hex('invoice-register-001');

describe('the simulated identity check', () => {
  const allowed = Wallet.generate().address;
  const other = Wallet.generate().address;
  const checker = simulatedIdentityChecker(new Set([allowed]));

  it('verifies a payee on the allow-list and fails every other payee', async () => {
    expect(
      (await checker.check(SUPPLIER_ID, { address: allowed, destinationTag: null })).status,
    ).toBe('verified');
    expect(
      (await checker.check(SUPPLIER_ID, { address: other, destinationTag: null })).status,
    ).toBe('failed');
  });

  it('labels its reference as simulated, and the reference never contains the payee address', async () => {
    const result = await checker.check(SUPPLIER_ID, { address: allowed, destinationTag: null });
    expect(result.reference.startsWith('simulated-identity:')).toBe(true);
    expect(result.reference).not.toContain(allowed);
  });
});

function evidenceFile(overrides: Partial<EvidenceFile> = {}): EvidenceFile {
  return {
    schemaVersion: 1,
    invoices: [
      {
        fingerprint: FINGERPRINT,
        supplierId: SUPPLIER_ID,
        invoiceNumber: 'INV-900',
        currency: 'USD',
        amountMinor: 1000,
        purchaseOrderId: 'PO-900',
        payeeAccountAsPrinted: null,
      },
    ],
    purchaseOrders: [
      { purchaseOrderId: 'PO-900', supplierId: SUPPLIER_ID, currency: 'USD', amountMinor: 1000 },
    ],
    goodsReceipts: [
      { purchaseOrderId: 'PO-900', receivedMinor: 1000, receivedAt: '2026-11-10T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('the fixture has no entries');
  }
  return item;
}

describe('the evidence register', () => {
  it('finds an invoice, a purchase order and a receipt by their keys, and finds nothing for an unknown key', () => {
    const register = evidenceRegister(evidenceFile());
    expect(register.invoice(FINGERPRINT)?.invoiceNumber).toBe('INV-900');
    expect(register.purchaseOrder('PO-900')?.amountMinor).toBe(1000);
    expect(register.goodsReceipt('PO-900')?.receivedMinor).toBe(1000);
    expect(register.invoice(sha256Hex('unknown'))).toBeUndefined();
    expect(register.purchaseOrder('PO-none')).toBeUndefined();
    expect(register.goodsReceipt('PO-none')).toBeUndefined();
  });

  it('refuses a file that repeats an invoice, a purchase order or a receipt', () => {
    const fixture = evidenceFile();
    const invoice = first(fixture.invoices);
    const order = first(fixture.purchaseOrders);
    const receipt = first(fixture.goodsReceipts);
    expect(() => evidenceRegister(evidenceFile({ invoices: [invoice, invoice] }))).toThrow(
      'repeats the invoice fingerprint',
    );
    expect(() => evidenceRegister(evidenceFile({ purchaseOrders: [order, order] }))).toThrow(
      'repeats the purchase order',
    );
    expect(() => evidenceRegister(evidenceFile({ goodsReceipts: [receipt, receipt] }))).toThrow(
      'repeats the goods receipt',
    );
  });

  it('reads a valid evidence file, and refuses one that does not match the schema', () => {
    expect(
      loadEvidence(writeJson('evidence-valid.json', evidenceFile())).invoice(FINGERPRINT),
    ).toBeDefined();
    expect(() =>
      loadEvidence(writeJson('evidence-invalid.json', { ...evidenceFile(), extra: true })),
    ).toThrow();
  });
});

const VALID_CONFIG: WardenConfigFile = {
  schemaVersion: 1,
  buyerScope: 'buyer-test',
  policyVersion: '2026-11-10.1',
  expectedAsset: { currency: 'USD', ledgerCurrency: 'TST', issuer: Wallet.generate().address },
  alternateAssets: [],
  spendingAddress: Wallet.generate().address,
  agentAddress: Wallet.generate().address,
  wardenAddress: Wallet.generate().address,
  coolingOffHours: 24,
  matchTolerance: { absoluteMinor: 100, basisPoints: 100 },
  limits: { perPaymentMinor: 100_000, supplierDailyMinor: 500_000, dailyTotalMinor: 1_000_000 },
  submission: { pollMs: 0, maxPolls: 60 },
  listen: { host: '127.0.0.1', port: 8787 },
  verifiedPayees: [Wallet.generate().address],
};

describe('the configuration file', () => {
  it('reads a valid configuration, and converts cooling-off hours to milliseconds', () => {
    const config = loadConfig(writeJson('config-valid.json', VALID_CONFIG));
    expect(config.coolingOffMs).toBe(24 * 60 * 60 * 1000);
    expect(config.expectedAsset.ledgerCurrency).toBe('TST');
    expect(resolveConfig(VALID_CONFIG).verifiedPayees).toEqual(VALID_CONFIG.verifiedPayees);
  });

  it('refuses a configuration with an invalid address, a missing field, or a field the schema does not allow', () => {
    expect(() =>
      loadConfig(
        writeJson('config-address.json', { ...VALID_CONFIG, agentAddress: 'not-an-address' }),
      ),
    ).toThrow();
    expect(() =>
      loadConfig(writeJson('config-extra.json', { ...VALID_CONFIG, extra: true })),
    ).toThrow();
    const withoutListen = Object.fromEntries(
      Object.entries(VALID_CONFIG).filter(([key]) => key !== 'listen'),
    );
    expect(() => loadConfig(writeJson('config-missing.json', withoutListen))).toThrow();
  });
});

describe('the keys file', () => {
  const seed = Wallet.generate().seed ?? '';
  const principal = (id: string, role: 'agent' | 'operator', bytes = 32) => ({
    id,
    role,
    secret: randomBytes(bytes).toString('base64'),
  });
  const keysFile = (principals: unknown[], walletSeed = seed) => ({
    schemaVersion: 1,
    wardenSeed: walletSeed,
    principals,
  });

  it('reads the Warden seed and the principals, each with its own secret', () => {
    const keys = loadKeys(
      writeJson(
        'keys-valid.json',
        keysFile([principal('agent-1', 'agent'), principal('operator-a', 'operator')]),
      ),
    );
    expect(keys.wardenSeed).toBe(seed);
    expect([...keys.principals.keys()]).toEqual(['agent-1', 'operator-a']);
  });

  it('refuses a principal secret shorter than 32 bytes, and a principal id that is repeated', () => {
    expect(() =>
      loadKeys(writeJson('keys-weak.json', keysFile([principal('agent-1', 'agent', 30)]))),
    ).toThrow('weak or repeated principal secret');
    expect(() =>
      loadKeys(
        writeJson(
          'keys-repeat.json',
          keysFile([principal('agent-1', 'agent'), principal('agent-1', 'operator')]),
        ),
      ),
    ).toThrow('weak or repeated principal secret');
  });

  it('refuses a Warden seed that is not a seed', () => {
    expect(() =>
      loadKeys(
        writeJson('keys-seed.json', keysFile([principal('agent-1', 'agent')], 'not-a-seed')),
      ),
    ).toThrow();
  });
});

describe('reading the ledger before signing', () => {
  const createdAt = '2026-11-10T10:00:00.000Z';
  const account = (address: string, role: RegistryAccount['role']): RegistryAccount => ({
    role,
    address,
    status: 'active',
    createdAt,
  });

  it('reports missing accounts and lines as absent, and never as present', async () => {
    const port = {
      account: () => Promise.resolve(null),
      trustLine: () => Promise.resolve(null),
    } as unknown as LedgerPort;
    const facts = await readPreSigning(port, {
      spending: Wallet.generate().address,
      destination: Wallet.generate().address,
      issuer: Wallet.generate().address,
      ledgerCurrency: 'TST',
      agent: account(Wallet.generate().address, 'agent'),
      warden: account(Wallet.generate().address, 'warden'),
    });
    expect(facts).toMatchObject({
      spendingExists: false,
      masterDisabled: false,
      regularKeyPresent: true,
      signerListMatches: false,
      issuerGlobalFreeze: false,
      spendingLine: null,
      destinationExists: false,
      destinationLine: null,
    });
  });
});
