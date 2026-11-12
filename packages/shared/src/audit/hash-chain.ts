/**
 * A hash-chained, append-only transition log (Lane E item 5). Each entry carries the hash of the entry before it, so any
 * edit, deletion, reordering or insertion of a past entry breaks verification at the first bad index. Node-only (uses
 * node:crypto for Ed25519 signatures on exports).
 */
import { createHash, sign, verify, type KeyObject } from 'node:crypto';

import { canonicalJson } from '../canonical.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainEntry<T = unknown> {
  readonly seq: number;
  readonly prevHash: string;
  readonly payload: T;
  readonly hash: string;
}

function hashOf(seq: number, prevHash: string, payload: unknown): string {
  return createHash('sha256').update(canonicalJson({ seq, prevHash, payload })).digest('hex');
}

/** Appends a payload after the current head. Pure: returns the new entry, does not write it. */
export function appendEntry<T>(chain: readonly ChainEntry<T>[], payload: T): ChainEntry<T> {
  const head = chain.at(-1);
  const seq = head === undefined ? 1 : head.seq + 1;
  const prevHash = head === undefined ? GENESIS_HASH : head.hash;
  return { seq, prevHash, payload, hash: hashOf(seq, prevHash, payload) };
}

export type ChainCheck =
  | { readonly ok: true; readonly length: number; readonly head: string }
  | { readonly ok: false; readonly index: number; readonly reason: string };

/** Verifies every link and every hash. Reports the first index that does not match. */
export function verifyChain(chain: readonly ChainEntry[]): ChainCheck {
  let prev = GENESIS_HASH;
  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i];
    if (entry === undefined) {
      return { ok: false, index: i, reason: 'missing entry' };
    }
    if (entry.seq !== i + 1) {
      return { ok: false, index: i, reason: `sequence ${String(entry.seq)} where ${String(i + 1)} was expected` };
    }
    if (entry.prevHash !== prev) {
      return { ok: false, index: i, reason: 'previous hash does not match the entry before' };
    }
    if (entry.hash !== hashOf(entry.seq, entry.prevHash, entry.payload)) {
      return { ok: false, index: i, reason: 'entry hash does not match its contents' };
    }
    prev = entry.hash;
  }
  return { ok: true, length: chain.length, head: prev };
}

/** A per-payment export: the entries for one payment, the head hash of the whole chain, and an Ed25519 signature. */
export interface SignedExport {
  readonly paymentId: string;
  readonly chainHead: string;
  readonly chainLength: number;
  readonly entries: readonly ChainEntry[];
  readonly signature: string;
}

/** Exports the entries for one payment. Refuses to export from a chain that does not verify. */
export function signedExport(
  chain: readonly ChainEntry[],
  paymentId: string,
  paymentOf: (entry: ChainEntry) => string | null,
  privateKey: KeyObject,
): SignedExport {
  const check = verifyChain(chain);
  if (!check.ok) {
    throw new Error(`refusing to export: the chain fails at index ${String(check.index)} (${check.reason})`);
  }
  const entries = chain.filter((entry) => paymentOf(entry) === paymentId);
  const body = { paymentId, chainHead: check.head, chainLength: check.length, entries };
  const signature = sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64');
  return { ...body, signature };
}

/** Checks an export's signature with the public key. A changed body fails. */
export function verifyExport(exported: SignedExport, publicKey: KeyObject): boolean {
  const { signature, ...body } = exported;
  return verify(null, Buffer.from(canonicalJson(body)), publicKey, Buffer.from(signature, 'base64'));
}
