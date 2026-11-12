import { timingSafeEqual } from 'node:crypto';

import {
  signatureFor,
  signingText,
  type SignedHeaders,
} from '../../../packages/warden-api/src/signing.js';

/**
 * Request authentication for the agent and operator routes. Each caller has its own secret. A request carries a
 * timestamp and a nonce, and the signature covers the method, path, timestamp, nonce and body, so a captured
 * request cannot be replayed or moved to another route. The signing functions are shared with the callers (see
 * packages/warden-api); this module holds the Warden's side, which verifies.
 */

export { signatureFor, signingText };
export type { SignedHeaders };

export type Role = 'agent' | 'operator';

export interface Principal {
  readonly id: string;
  readonly role: Role;
  readonly secret: Buffer;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Checks a request. Throws AuthError with a generic message: the reason is never sent to the caller. */
export class RequestVerifier {
  private readonly seenNonces = new Map<string, number>();

  constructor(
    private readonly principals: ReadonlyMap<string, Principal>,
    private readonly now: () => Date,
    private readonly startedAtMs: number,
    private readonly windowMs = 300_000,
  ) {}

  verify(input: {
    readonly method: string;
    readonly path: string;
    readonly headers: SignedHeaders | null;
    readonly body: string;
    readonly role: Role;
  }): Principal {
    const headers = input.headers;
    if (headers === null) {
      throw new AuthError('authentication required');
    }
    const principal = this.principals.get(headers.principal);
    if (principal?.role !== input.role) {
      throw new AuthError('authentication failed');
    }
    const nowMs = this.now().getTime();
    const sentMs = Date.parse(headers.timestamp);
    if (Number.isNaN(sentMs) || Math.abs(nowMs - sentMs) > this.windowMs) {
      throw new AuthError('authentication failed');
    }
    // A request sent before this process started may have been accepted by an earlier process, whose nonces are
    // gone. Such a request is refused even inside the window, so a restart cannot be used to replay it.
    if (sentMs < this.startedAtMs) {
      throw new AuthError('authentication failed');
    }
    const expected = signatureFor(
      principal.secret,
      signingText(input.method, input.path, headers.timestamp, headers.nonce, input.body),
    );
    if (!sameHex(expected, headers.signature)) {
      throw new AuthError('authentication failed');
    }
    this.pruneNonces(nowMs);
    const nonceKey = `${principal.id}:${headers.nonce}`;
    if (this.seenNonces.has(nonceKey)) {
      throw new AuthError('authentication failed');
    }
    this.seenNonces.set(nonceKey, nowMs + 2 * this.windowMs);
    return principal;
  }

  private pruneNonces(nowMs: number): void {
    for (const [key, expiresMs] of this.seenNonces) {
      if (expiresMs < nowMs) {
        this.seenNonces.delete(key);
      }
    }
  }
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
