import { createHash } from 'node:crypto';

/**
 * Canonical JSON and hashing. Node-only, because it hashes. The Warden and the agent both use these functions,
 * so a proposal, a decision and a record hash to the same value wherever they are computed.
 */

/** SHA-256 of a UTF-8 string, as lower-case hex. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of raw bytes, as lower-case hex. A file's fingerprint is taken over its bytes, never over decoded text. */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Keys are sorted by the default string order, which compares UTF-16 code units and so never depends on locale. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sortKeys(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(Reflect.get(record, key))]),
    );
  }
  return value;
}

/**
 * JSON text with object keys sorted at every depth. Equal values always give equal text, so the text can
 * be hashed, signed and compared byte for byte.
 */
export function canonicalJson(value: unknown): string {
  // JSON.stringify returns undefined for a value such as undefined, which is written as null so it can be hashed.
  const text = JSON.stringify(sortKeys(value)) as string | undefined;
  return text ?? 'null';
}

/** SHA-256 of the canonical JSON of a value. Used for proposal and decision fingerprints. */
export function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
