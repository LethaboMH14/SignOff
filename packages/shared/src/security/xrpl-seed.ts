import { timingSafeEqual } from 'node:crypto';

import { base58Decode } from './base58.js';
import { doubleSha256 } from './checksum.js';

/**
 * Decoded sizes of XRPL family seeds: 16 bytes of entropy, a version prefix and a 4-byte checksum.
 * 21 bytes is the secp256k1 form (one-byte prefix); 23 bytes is the ed25519 form (three-byte prefix).
 */
const SEED_DECODED_SIZES: readonly number[] = [21, 23];
const CHECKSUM_SIZE = 4;

/**
 * True when the text is a valid XRPL family seed: base58 text that decodes to a seed size and
 * whose checksum verifies. The version prefix is deliberately not checked, so a seed format this
 * list does not know yet is still caught. The 32-bit checksum keeps accidental matches very rare.
 */
export function isXrplFamilySeed(candidate: string): boolean {
  const decoded = base58Decode(candidate);
  if (decoded === undefined || !SEED_DECODED_SIZES.includes(decoded.length)) return false;

  const payload = decoded.subarray(0, decoded.length - CHECKSUM_SIZE);
  const claimed = decoded.subarray(decoded.length - CHECKSUM_SIZE);
  const expected = doubleSha256(payload).subarray(0, CHECKSUM_SIZE);
  return timingSafeEqual(expected, claimed);
}
