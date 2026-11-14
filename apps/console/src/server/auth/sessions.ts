import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { type Role } from './operators.js';

/**
 * Sign-in sessions for the console. A session is a random token in an HttpOnly cookie. Each session has its own CSRF
 * token, which the page sends back in a header on every change. A change to a pause, a limit or an approval also needs
 * a recent step-up: the person enters their password again, and the session is then fresh for a few minutes only.
 *
 * Two stores share one interface. SessionStore keeps each session in memory, on the server, and is the default. The
 * signed store keeps nothing: the cookie carries the session and an HMAC over it, made with a secret only the server
 * holds, so a cookie cannot be forged or changed. It is for hosts that do not keep memory between requests.
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
  /** The cookie value that names this session. A step-up can give the session a new value, which the response must set. */
  token: string;
}

/** What the API needs from a session store. */
export interface SessionStoreApi {
  open(username: string, role: Role): { readonly token: string; readonly session: Session };
  lookup(token: string | null): Session | null;
  stepUp(session: Session): number;
  isSteppedUp(session: Session): boolean;
  close(token: string): void;
}

function keyOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export class SessionStore implements SessionStoreApi {
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
      token,
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

interface Payload {
  /** The username. */
  readonly u: string;
  readonly r: Role;
  /** The CSRF token. */
  readonly c: string;
  /** When the session began, in milliseconds. */
  readonly t: number;
  /** When the step-up lasts until, in milliseconds; 0 when there is none. */
  readonly s: number;
}

function payloadOf(body: string): Payload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const { u, r, c, t, s } = parsed as Record<string, unknown>;
  if (
    typeof u !== 'string' ||
    (r !== 'viewer' && r !== 'operator') ||
    typeof c !== 'string' ||
    typeof t !== 'number' ||
    typeof s !== 'number'
  ) {
    return null;
  }
  return { u, r, c, t, s };
}

/**
 * Sessions with no server-side state. Limits of this design: a session cannot be revoked before it expires, so signing
 * out clears the browser's cookie only; and the idle timeout is not enforced, although the absolute lifetime is.
 */
export class SignedSessionStore implements SessionStoreApi {
  constructor(
    private readonly now: () => number,
    private readonly secret: Buffer,
    private readonly timing: SessionTiming = DEFAULT_TIMING,
  ) {
    if (secret.length < 32) {
      throw new RangeError('the session secret must be at least 32 bytes');
    }
  }

  open(username: string, role: Role): { readonly token: string; readonly session: Session } {
    const at = this.now();
    const payload: Payload = {
      u: username,
      r: role,
      c: randomBytes(32).toString('base64url'),
      t: at,
      s: 0,
    };
    const token = this.sign(payload);
    return { token, session: this.sessionOf(payload, token, at) };
  }

  lookup(token: string | null): Session | null {
    if (token === null || token.length > 2000) {
      return null;
    }
    const payload = this.verify(token);
    if (payload === null) {
      return null;
    }
    const at = this.now();
    if (at - payload.t > this.timing.absoluteMs) {
      return null;
    }
    return this.sessionOf(payload, token, at);
  }

  stepUp(session: Session): number {
    const until = this.now() + this.timing.stepUpMs;
    session.stepUpUntilMs = until;
    session.token = this.sign({
      u: session.username,
      r: session.role,
      c: session.csrfToken,
      t: session.createdMs,
      s: until,
    });
    return until;
  }

  isSteppedUp(session: Session): boolean {
    return this.now() <= session.stepUpUntilMs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the store interface passes the token; nothing is kept on the server to forget
  close(_token: string): void {
    // Nothing is kept on the server, so there is nothing to forget. The response clears the browser's cookie.
  }

  private sign(payload: Payload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${body}.${this.tag(body)}`;
  }

  private tag(body: string): string {
    return createHmac('sha256', this.secret).update(body, 'utf8').digest('base64url');
  }

  private verify(token: string): Payload | null {
    const dot = token.lastIndexOf('.');
    if (dot < 1) {
      return null;
    }
    const body = token.slice(0, dot);
    const expected = Buffer.from(this.tag(body), 'utf8');
    const given = Buffer.from(token.slice(dot + 1), 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return null;
    }
    return payloadOf(body);
  }

  private sessionOf(payload: Payload, token: string, at: number): Session {
    return {
      username: payload.u,
      role: payload.r,
      csrfToken: payload.c,
      createdMs: payload.t,
      lastSeenMs: at,
      stepUpUntilMs: payload.s > 0 ? payload.s : Number.NEGATIVE_INFINITY,
      token,
    };
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
