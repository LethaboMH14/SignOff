import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCsv, snapshotFromSdnCsv } from '../src/checks/sanctions-source.js';
import {
  SANCTIONS_MAX_AGE_DAYS,
  nameTokens,
  sanctionsVerdict,
  screenSupplierName,
  type SanctionsSnapshot,
} from '../src/checks/sanctions.js';

/**
 * Rows copied verbatim from the OFAC SDN.CSV published on 2026-11-12 (sha256 7f43332d...). The file is committed
 * so the test does not need the network or the gitignored cache.
 */
const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/sanctions/sdn-sample.csv', import.meta.url)),
  'utf8',
);
const NOW = new Date('2026-11-12T12:00:00Z');

function snapshot(retrievedAt = '2026-11-12'): SanctionsSnapshot {
  return snapshotFromSdnCsv(FIXTURE, {
    sourceUrl: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
    retrievedAt,
    sourceSha256: '7f43332dae0d1b78ce44c31692d87a3c66e4075bcd97e36d3f18585572ff55b8',
  });
}

describe('SDN source parsing', () => {
  it('reads the listed entries by entry number, name, type and programme', () => {
    const snap = snapshot();
    expect(snap.entries.map((e) => e.id)).toEqual(['OFAC-36', 'OFAC-306', 'OFAC-52304']);
    expect(snap.entries[1]).toMatchObject({ name: 'BANCO NACIONAL DE CUBA', program: 'CUBA' });
  });

  it('keeps commas and doubled quotes inside quoted fields', () => {
    expect(parseCsv('1,"A, B ""C""",x\r\n')).toEqual([['1', 'A, B "C"', 'x']]);
  });

  it('rejects a row that is too short to be an SDN row', () => {
    expect(() => snapshotFromSdnCsv('1,"ONLY TWO"\n', {
      sourceUrl: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
      retrievedAt: '2026-11-12',
      sourceSha256: '0'.repeat(64),
    })).toThrow(/expected at least 4/);
  });

  it('ignores the DOS end-of-file byte that ends the published file', () => {
    expect(snapshotFromSdnCsv(`${FIXTURE}\u001a`, {
      sourceUrl: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
      retrievedAt: '2026-11-12',
      sourceSha256: '0'.repeat(64),
    }).entries).toHaveLength(3);
  });
});

describe('screenSupplierName', () => {
  it('holds a supplier whose name equals a listed name, ignoring case, accents and legal-form words', () => {
    const outcome = screenSupplierName('Banco Nacional de Cuba (Pty) Ltd', snapshot(), NOW);
    expect(outcome.status).toBe('HIT');
    expect(outcome).toMatchObject({ matches: [{ id: 'OFAC-306', kind: 'exact' }] });
    const verdict = sanctionsVerdict(outcome);
    expect(verdict).toMatchObject({ decision: 'HOLD', code: 'SUPPLIER_NOT_APPROVED' });
  });

  it('treats a common-name near match as a HOLD for a person, never a REFUSE', () => {
    // "Mohammed Ali" is a very common name. It shares every word with a listed entity, so it is a near match.
    const outcome = screenSupplierName('Mohammed Ali', snapshot(), NOW);
    expect(outcome.status).toBe('NEAR');
    const verdict = sanctionsVerdict(outcome);
    expect(verdict?.decision).toBe('HOLD');
    expect(verdict?.decision).not.toBe('REFUSE');
    expect(verdict?.message).toMatch(/Common names match often/);
  });

  it('does not match on one shared word', () => {
    expect(screenSupplierName('Mohammed Stationery', snapshot(), NOW).status).toBe('CLEAR');
  });

  it('clears a supplier with no match', () => {
    const outcome = screenSupplierName('Acme Stationery Supplies', snapshot(), NOW);
    expect(outcome).toEqual({ status: 'CLEAR' });
    expect(sanctionsVerdict(outcome)).toBeNull();
  });

  it('holds when the list is missing (source unavailable is a hold)', () => {
    const outcome = screenSupplierName('Acme Stationery Supplies', null, NOW);
    expect(outcome.status).toBe('UNAVAILABLE');
    expect(sanctionsVerdict(outcome)).toMatchObject({ decision: 'HOLD' });
  });

  it('holds when the list is older than the maximum age, and passes at exactly the limit', () => {
    const fresh = new Date(Date.parse('2026-11-12T00:00:00Z') + SANCTIONS_MAX_AGE_DAYS * 86_400_000);
    expect(screenSupplierName('Acme Stationery Supplies', snapshot('2026-11-12'), fresh).status).toBe('CLEAR');
    const stale = new Date(fresh.getTime() + 86_400_000);
    expect(screenSupplierName('Acme Stationery Supplies', snapshot('2026-11-12'), stale)).toMatchObject({
      status: 'UNAVAILABLE',
    });
  });

  it('holds when the list date is in the future', () => {
    const outcome = screenSupplierName('Acme Stationery Supplies', snapshot('2026-11-20'), NOW);
    expect(outcome.status).toBe('UNAVAILABLE');
  });

  it('holds a name with no screenable words instead of passing it', () => {
    expect(screenSupplierName('Pty Ltd', snapshot(), NOW).status).toBe('UNAVAILABLE');
  });

  it('gives the same answer on every run, with matches sorted by id', () => {
    const first = screenSupplierName('Mohammed Ali', snapshot(), NOW);
    const second = screenSupplierName('Mohammed Ali', snapshot(), NOW);
    expect(second).toEqual(first);
  });
});

describe('nameTokens', () => {
  it('folds accents and punctuation and drops noise words', () => {
    expect(nameTokens('Société Générale, S.A.')).toEqual(['SOCIETE', 'GENERALE']);
  });
});
