import { base58Encode } from '../../src/security/base58.js';
import { doubleSha256 } from '../../src/security/checksum.js';

/**
 * Test fixtures are built at run time, so no secret-shaped value is ever written into the
 * repository. A checksum-valid seed in a source file would be a real leak to the scanner
 * and to anyone who reads the history.
 */

/** Version prefix of a secp256k1 family seed. */
export const SECP256K1_SEED_PREFIX = Uint8Array.of(0x21);

/** Three-byte prefix of an ed25519 family seed. The detector does not depend on it. */
export const ED25519_SEED_PREFIX = Uint8Array.of(0x01, 0xe1, 0x4b);

/** Concatenate byte arrays. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/** Deterministic 16-byte entropy, so a failing test reproduces exactly. */
export function fixedEntropy(seed: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, index) => (seed * 31 + index * 17) & 0xff);
}

/** Build a checksum-valid XRPL family seed from a prefix and 16 bytes of entropy. */
export function encodeFamilySeed(prefix: Uint8Array, entropy: Uint8Array): string {
  const payload = concatBytes(prefix, entropy);
  const checksum = doubleSha256(payload).subarray(0, 4);
  return base58Encode(concatBytes(payload, checksum));
}

/** Replace one character with a different base58 character. The result is no longer a valid seed. */
export function corruptOneCharacter(text: string, index: number): string {
  const original = text.charAt(index);
  const replacement = original === 'r' ? 'p' : 'r';
  return text.slice(0, index) + replacement + text.slice(index + 1);
}

/** The account-zero address. It is public and must never be reported as a secret. */
export const ACCOUNT_ZERO_ADDRESS = 'rrrrrrrrrrrrrrrrrrrrrhoLvTp';
