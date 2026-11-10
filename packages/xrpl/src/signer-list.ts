import type { SignerSpec } from './transactions.js';

/** A signer list as it should be (expected) or as the ledger reports it (actual). */
export interface SignerListView {
  readonly quorum: number;
  readonly entries: readonly SignerSpec[];
}

export type SignerListDifference =
  'missing' | 'quorum' | 'entry-count' | 'entry-missing' | 'weight';

/**
 * Compares the ledger's signer list with the expected one. An empty result means they match exactly.
 * Differences are reported as codes, never as addresses, so they are safe to log.
 */
export function diffSignerList(
  expected: SignerListView,
  actual: SignerListView | null,
): SignerListDifference[] {
  if (actual === null) {
    return ['missing'];
  }
  const differences = new Set<SignerListDifference>();
  if (actual.quorum !== expected.quorum) {
    differences.add('quorum');
  }
  if (actual.entries.length !== expected.entries.length) {
    differences.add('entry-count');
  }
  const actualWeights = new Map(actual.entries.map((entry) => [entry.account, entry.weight]));
  for (const entry of expected.entries) {
    const weight = actualWeights.get(entry.account);
    if (weight === undefined) {
      differences.add('entry-missing');
    } else if (weight !== entry.weight) {
      differences.add('weight');
    }
  }
  return [...differences];
}
