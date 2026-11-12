import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SignedSessionStore, type SessionTiming } from '../src/server/auth/sessions.js';

const SECRET = randomBytes(32);
const TIMING: SessionTiming = { idleMs: 60_000, absoluteMs: 3_600_000, stepUpMs: 300_000 };

function clockAt(start: number): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

describe('signed sessions (no server-side state)', () => {
  it('reads back the session a sign-in named, from the cookie alone', () => {
    const clock = clockAt(1_000_000);
    const store = new SignedSessionStore(clock.now, SECRET, TIMING);
    const { token, session } = store.open('vera', 'viewer');
    const again = new SignedSessionStore(clock.now, SECRET, TIMING).lookup(token);
    expect(again).toMatchObject({ username: 'vera', role: 'viewer', csrfToken: session.csrfToken });
  });

  it('refuses a cookie whose body was changed, and a cookie signed with another secret', () => {
    const clock = clockAt(1_000_000);
    const store = new SignedSessionStore(clock.now, SECRET, TIMING);
    const { token } = store.open('vera', 'viewer');
    const [body, tag] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ u: 'vera', r: 'operator', c: 'x', t: 1_000_000, s: 0 }),
      'utf8',
    ).toString('base64url');
    expect(store.lookup(`${forged}.${tag}`)).toBeNull();
    expect(store.lookup(`${body}.${'A'.repeat(tag.length)}`)).toBeNull();
    const other = new SignedSessionStore(clock.now, randomBytes(32), TIMING);
    expect(other.lookup(token)).toBeNull();
    expect(store.lookup(null)).toBeNull();
    expect(store.lookup('not-a-session')).toBeNull();
  });

  it('ends a session after its absolute lifetime', () => {
    const clock = clockAt(1_000_000);
    const store = new SignedSessionStore(clock.now, SECRET, TIMING);
    const { token } = store.open('vera', 'viewer');
    clock.advance(TIMING.absoluteMs + 1);
    expect(store.lookup(token)).toBeNull();
  });

  it('gives a step-up a new cookie value, which keeps the step-up across requests', () => {
    const clock = clockAt(1_000_000);
    const store = new SignedSessionStore(clock.now, SECRET, TIMING);
    const { session } = store.open('demo.operator', 'operator');
    const before = session.token;
    expect(store.isSteppedUp(session)).toBe(false);
    store.stepUp(session);
    expect(session.token).not.toBe(before);
    const later = store.lookup(session.token);
    expect(later !== null && store.isSteppedUp(later)).toBe(true);
    clock.advance(TIMING.stepUpMs + 1);
    const expired = store.lookup(session.token);
    expect(expired !== null && store.isSteppedUp(expired)).toBe(false);
  });

  it('refuses to start with a secret shorter than 32 bytes', () => {
    expect(() => new SignedSessionStore(() => 0, randomBytes(16), TIMING)).toThrow(RangeError);
  });
});
