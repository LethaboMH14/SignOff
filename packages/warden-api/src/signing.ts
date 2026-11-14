import { createHmac } from 'node:crypto';

import { sha256Hex } from '../../shared/src/canonical.js';

/**
 * Request signing for the Warden's API. Each caller has its own secret. A request carries a timestamp and a nonce,
 * and the signature covers the method, path, timestamp, nonce and a hash of the body. A captured request therefore
 * cannot be replayed, or moved to another route, without the secret. The Warden verifies with the same functions.
 */

export interface SignedHeaders {
  readonly principal: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly signature: string;
}

/** The text that is signed. Any change to a field changes the signature. */
export function signingText(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return [method, path, timestamp, nonce, sha256Hex(body)].join('\n');
}

export function signatureFor(secret: Buffer, text: string): string {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}
