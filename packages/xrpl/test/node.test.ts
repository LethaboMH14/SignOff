import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileJournalStore,
  fileRegistryStore,
  toJournalRecord,
  withLock,
} from '../src/node.js';
import { emptyRegistry, type Registry } from '../src/registry.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signoff-xrpl-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const registry: Registry = {
  ...emptyRegistry(),
  accounts: [
    {
      role: 'agent',
      address: 'rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
      status: 'active',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
  ],
};

describe('defaultLocalDir', () => {
  it('honours the override, then falls back to the platform default', () => {
    expect(defaultLocalDir({ SIGNOFF_LOCAL_DIR: join(dir, 'custom') }, 'linux')).toBe(
      join(dir, 'custom'),
    );
    expect(defaultLocalDir({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32')).toBe(
      join('C:\\Users\\x\\AppData\\Local', 'SignOff', 'testnet'),
    );
    expect(defaultLocalDir({}, 'win32')).toContain(join('SignOff', 'testnet'));
    expect(defaultLocalDir({}, 'linux')).toContain(join('.signoff', 'testnet'));
    expect(defaultLocalDir({ SIGNOFF_LOCAL_DIR: '' }, 'linux')).toContain(
      join('.signoff', 'testnet'),
    );
  });
});

describe('assertOutsideRepository', () => {
  it('accepts a sibling directory and refuses the repository itself or anything inside it', () => {
    const repo = join(dir, 'repo');
    expect(() => {
      assertOutsideRepository(join(dir, 'local'), repo);
    }).not.toThrow();
    expect(() => {
      assertOutsideRepository(repo, repo);
    }).toThrow('outside the repository');
    expect(() => {
      assertOutsideRepository(join(repo, 'keys'), repo);
    }).toThrow('outside the repository');
    expect(() => {
      assertOutsideRepository(resolve(repo, '..', 'repo-sibling'), repo);
    }).not.toThrow();
  });
});

describe('fileRegistryStore', () => {
  it('reads nothing from an empty directory, and round-trips a valid registry', async () => {
    const store = fileRegistryStore(join(dir, 'registry.json'));
    expect(await store.read()).toBeNull();
    await store.write(registry);
    expect(await store.read()).toEqual(registry);
  });

  it('refuses to write an invalid registry and to read a file that is not one', async () => {
    const store = fileRegistryStore(join(dir, 'registry.json'));
    await expect(
      store.write({ ...registry, network: 'mainnet' } as unknown as Registry),
    ).rejects.toThrow();
    const broken = fileRegistryStore(join(dir, 'broken.json'));
    await broken.write(registry);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'broken.json'), '{"schema":2}');
    await expect(broken.read()).rejects.toThrow();
  });
});

describe('fileJournalStore', () => {
  it('appends records and reads them back in order', async () => {
    const store = fileJournalStore(join(dir, 'journal.jsonl'));
    expect(await store.readAll()).toEqual([]);
    await store.append({
      paymentId: 'p1',
      attempt: 1,
      state: 'prepared',
      at: '2026-11-10T10:00:00.000Z',
      hash: 'H',
      txBlob: 'AA',
      lastLedgerSequence: 9,
    });
    await store.append({
      paymentId: 'p1',
      attempt: 1,
      state: 'paid',
      at: '2026-11-10T10:00:05.000Z',
      ledgerIndex: 10,
      engineResult: 'tesSUCCESS',
    });
    const records = await store.readAll();
    expect(records.map((record) => record.state)).toEqual(['prepared', 'paid']);
    expect(records[0]?.lastLedgerSequence).toBe(9);
    expect(records[1]?.ledgerIndex).toBe(10);
  });

  it('refuses journal lines with missing fields or the wrong types, rather than guessing', () => {
    expect(() => toJournalRecord('nope')).toThrow('not an object');
    expect(() => toJournalRecord(null)).toThrow('not an object');
    expect(() =>
      toJournalRecord({ paymentId: 'p', attempt: 1, state: 'unknown', at: 'x' }),
    ).toThrow('missing required fields');
    expect(() =>
      toJournalRecord({ paymentId: 'p', attempt: 1, state: 'paid', at: 'x', hash: 5 }),
    ).toThrow('hash has the wrong type');
    expect(() =>
      toJournalRecord({ paymentId: 'p', attempt: 1, state: 'paid', at: 'x', ledgerIndex: '5' }),
    ).toThrow('ledgerIndex has the wrong type');
    expect(
      toJournalRecord({
        paymentId: 'p',
        attempt: 1,
        state: 'held',
        at: 'x',
        reason: 'delivered-mismatch',
      }),
    ).toEqual({
      paymentId: 'p',
      attempt: 1,
      state: 'held',
      at: 'x',
      reason: 'delivered-mismatch',
    });
  });
});

describe('withLock', () => {
  it('runs one job at a time and releases the lock afterwards, even when the job fails', async () => {
    const result = await withLock(dir, () => Promise.resolve('done'));
    expect(result).toBe('done');
    await expect(withLock(dir, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await withLock(dir, () => Promise.resolve('again'))).toBe('again');
  });

  it('refuses a second run while the first holds the lock', async () => {
    await withLock(dir, async () => {
      await expect(withLock(dir, () => Promise.resolve('second'))).rejects.toThrow(
        'another run holds the lock',
      );
    });
  });
});
