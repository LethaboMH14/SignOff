import { createHash } from 'node:crypto';

/** SHA-256 applied twice, the checksum function behind XRPL base58check encodings. */
export function doubleSha256(data: Uint8Array): Uint8Array {
  const once = createHash('sha256').update(data).digest();
  return new Uint8Array(createHash('sha256').update(once).digest());
}
