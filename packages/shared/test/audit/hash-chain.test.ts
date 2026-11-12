import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  appendEntry,
  type ChainEntry,
  GENESIS_HASH,
  signedExport,
  verifyChain,
  verifyExport,
} from '../../src/audit/hash-chain.js';

function build(payloads: readonly { payment: string; note: string }[]): ChainEntry<{ payment: string; note: string }>[] {
  const chain: ChainEntry<{ payment: string; note: string }>[] = [];
  for (const payload of payloads) {
    chain.push(appendEntry(chain, payload));
  }
  return chain;
}

const SAMPLE = [
  { payment: 'P1', note: 'proposed' },
  { payment: 'P2', note: 'proposed' },
  { payment: 'P1', note: 'held' },
  { payment: 'P1', note: 'paid' },
];

describe('hash-chained transition log', () => {
  it('verifies an untouched chain and starts from the genesis hash', () => {
    const chain = build(SAMPLE);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    const result = verifyChain(chain);
    expect(result).toMatchObject({ ok: true, length: 4 });
  });

  it('detects an edited past entry at the edited index', () => {
    const chain = build(SAMPLE);
    const tampered = chain.map((entry, i) =>
      i === 2 ? { ...entry, payload: { payment: 'P1', note: 'released' } } : entry,
    );
    expect(verifyChain(tampered)).toMatchObject({ ok: false, index: 2 });
  });

  it('detects a deleted or reordered entry', () => {
    const chain = build(SAMPLE);
    expect(verifyChain([chain[0], chain[2], chain[3]] as ChainEntry[])).toMatchObject({ ok: false, index: 1 });
    expect(verifyChain([chain[1], chain[0], chain[2], chain[3]] as ChainEntry[])).toMatchObject({ ok: false, index: 0 });
  });

  it('exports one payment with a signature that fails if the body changes', () => {
    const chain = build(SAMPLE);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const exported = signedExport(chain, 'P1', (entry) => (entry.payload as { payment: string }).payment, privateKey);
    expect(exported.entries.map((e) => e.seq)).toEqual([1, 3, 4]);
    expect(exported.chainLength).toBe(4);
    expect(verifyExport(exported, publicKey)).toBe(true);
    expect(verifyExport({ ...exported, chainHead: 'f'.repeat(64) }, publicKey)).toBe(false);
  });

  it('refuses to export from a chain that does not verify', () => {
    const chain = build(SAMPLE);
    const tampered = chain.map((entry, i) => (i === 0 ? { ...entry, payload: { payment: 'P1', note: 'x' } } : entry));
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() => signedExport(tampered, 'P1', () => 'P1', privateKey)).toThrow(/refusing to export/);
  });
});
