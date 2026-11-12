import { createHash, randomBytes } from 'node:crypto';

import { type Role } from './operators.js';

/**
 * Sign-in sessions for the console. A session is a random token in an HttpOnly cookie. The server keeps only a hash of
 * the token. Each session has its own CSRF token, which the page sends back in a header on every change. A change to a
 * pause, a limit or an approval also needs a recent step-up: the person enters their password again, and the session
 * is then fresh for a few minutes only.
 */

export interface SessionTiming {
  /** A session with no request for this long is over. */
  readonly idleMs: number;
  /** A session is over this long after it began, however busy it was. */
  readonly absoluteMs: number;
  /** How long a step-up stays fresh. */
  readonly stepUpMs: number;
}

export const DEFAULT_TIMING: SessionTiming = {
  idleMs: 30 * 60_000,
  absoluteMs: 8 * 60 * 60_000,
  stepUpMs: 5 * 60_000,
};

export interface Session {
  readonly username: string;
  readonly role: Role;
  readonly csrfToken: string;
  readonly createdMs: number;
  lastSeenMs: number;
  stepUpUntilMs: number;
}

function keyOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly now: () => number,
    private readonly timing: SessionTiming = DEFAULT_TIMING,
  ) {}

  /** A new session and the token that names it. The token is shown to the browser once, in a cookie. */
  open(username: string, role: Role): { readonly token: string; readonly session: Session } {
    const token = randomBytes(32).toString('base64url');
    const at = this.now();
    const session: Session = {
      username,
      role,
      csrfToken: randomBytes(32).toString('base64url'),
      createdMs: at,
      lastSeenMs: at,
      stepUpUntilMs: Number.NEGATIVE_INFINITY,
    };
    this.sessions.set(keyOf(token), session);
    return { token, session };
  }

  /** The live session for a cookie token, or null. An expired session is removed the first time it is seen. */
  lookup(token: string | null): Session | null {
    if (token === null || token.length < 20 || token.length > 100) {
      return null;
    }
    const key = keyOf(token);
    const session = this.sessions.get(key);
    if (session === undefined) {
      return null;
    }
    const at = this.now();
    if (
      at - session.lastSeenMs > this.timing.idleMs ||
      at - session.createdMs > this.timing.absoluteMs
    ) {
      this.sessions.delete(key);
      return null;
    }
    session.lastSeenMs = at;
    return session;
  }

  /** Marks the session as freshly re-authenticated. Returns the time the step-up lasts until. */
  stepUp(session: Session): number {
    session.stepUpUntilMs = this.now() + this.timing.stepUpMs;
    return session.stepUpUntilMs;
  }

  isSteppedUp(session: Session): boolean {
    return this.now() <= session.stepUpUntilMs;
  }

  close(token: string): void {
    this.sessions.delete(keyOf(token));
  }
}

/** Refuses a person who has failed to sign in too often, for a while. The count is per username, never per address. */
export class LoginGuard {
  private readonly failures = new Map<
    string,
    { count: number; windowStartMs: number; lockedUntilMs: number }
  >();

  constructor(
    private readonly now: () => number,
    private readonly limit = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
  ) {}

  locked(username: string): boolean {
    const entry = this.failures.get(username.toLowerCase());
    return entry !== undefined && entry.lockedUntilMs > this.now();
  }

  failed(username: string): void {
    const key = username.toLowerCase();
    const at = this.now();
    const entry = this.failures.get(key);
    if (entry === undefined || at - entry.windowStartMs > this.windowMs) {
      this.failures.set(key, { count: 1, windowStartMs: at, lockedUntilMs: 0 });
      return;
    }
    entry.count += 1;
    if (entry.count >= this.limit) {
      entry.lockedUntilMs = at + this.lockMs;
      entry.count = 0;
      entry.windowStartMs = at;
    }
  }

  succeeded(username: string): void {
    this.failures.delete(username.toLowerCase());
  }
}
