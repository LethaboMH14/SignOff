import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadOperators, operatorStoreOf } from '../src/server/auth/operators.js';
import { hashPassword, passwordProblem, verifyPassword } from '../src/server/auth/passwords.js';
import { LoginGuard, SessionStore } from '../src/server/auth/sessions.js';

const SECRET = randomBytes(32).toString('base64');
const PLACEHOLDER_HASH = 'scrypt$placeholder';

describe('password hashes', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const password = randomBytes(18).toString('base64url');
    const stored = await hashPassword(password);
    expect(stored.startsWith('scrypt$N=16384$r=8$p=1$')).toBe(true);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword(`${password}x`, stored)).toBe(false);
  });

  it('never verifies a malformed or out-of-bounds stored hash', async () => {
    const password = randomBytes(18).toString('base64url');
    const malformed = [
      'not-a-hash',
      'scrypt$N=16384$r=8$p=1',
      'scrypt$N=999999999$r=8$p=1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      'scrypt$N=16384$r=8$p=1$AA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ];
    for (const stored of malformed) {
      expect(await verifyPassword(password, stored)).toBe(false);
    }
  });

  it('refuses a password that is too short or too long, and names only the rule', () => {
    expect(passwordProblem('short')).toMatch(/at least 12 characters/);
    expect(passwordProblem('x'.repeat(300))).toMatch(/at most 256 characters/);
    expect(passwordProblem('a long enough password')).toBeNull();
  });
});

describe('the operator file', () => {
  it('accepts an operator with a Warden principal, and a viewer with none; the lookup ignores case', () => {
    const store = operatorStoreOf([
      {
        username: 'alice',
        role: 'operator',
        passwordHash: PLACEHOLDER_HASH,
        wardenPrincipal: 'operator-alice',
        wardenSecret: SECRET,
      },
      {
        username: 'vera',
        role: 'viewer',
        passwordHash: PLACEHOLDER_HASH,
        wardenPrincipal: null,
        wardenSecret: null,
      },
    ]);
    expect(store.size).toBe(2);
    expect(store.find('ALICE')?.wardenPrincipal).toBe('operator-alice');
    expect(store.find('vera')?.role).toBe('viewer');
    expect(store.find('nobody')).toBeUndefined();
  });

  it('refuses an operator with no Warden principal, and a viewer with one', () => {
    expect(() =>
      operatorStoreOf([
        {
          username: 'alice',
          role: 'operator',
          passwordHash: PLACEHOLDER_HASH,
          wardenPrincipal: null,
          wardenSecret: null,
        },
      ]),
    ).toThrow();
    expect(() =>
      operatorStoreOf([
        {
          username: 'vera',
          role: 'viewer',
          passwordHash: PLACEHOLDER_HASH,
          wardenPrincipal: 'operator-vera',
          wardenSecret: SECRET,
        },
      ]),
    ).toThrow();
  });

  it('refuses one username twice, a field it does not know, and a hash that is not scrypt', () => {
    const alice = {
      username: 'alice',
      role: 'viewer',
      passwordHash: PLACEHOLDER_HASH,
      wardenPrincipal: null,
      wardenSecret: null,
    };
    expect(() => operatorStoreOf([alice, alice])).toThrow('names one username twice');
    expect(() => operatorStoreOf([{ ...alice, extra: true }])).toThrow();
    expect(() => operatorStoreOf([{ ...alice, passwordHash: 'plain text' }])).toThrow();
  });

  it('is empty when the file is missing, so nobody can sign in', () => {
    expect(loadOperators('/no/such/operator/file.json').size).toBe(0);
  });
});

describe('sessions', () => {
  it('finds a session by its token only, and keeps no raw token', () => {
    const store = new SessionStore(() => 1_000_000);
    const { token, session } = store.open('alice', 'operator');
    expect(store.lookup(token)).toBe(session);
    expect(store.lookup(session.csrfToken)).toBeNull();
    expect(store.lookup(null)).toBeNull();
    expect(store.lookup('short')).toBeNull();
  });

  it('ends a session after the idle time, and after the absolute time even when it is busy', () => {
    let at = 0;
    const store = new SessionStore(() => at, { idleMs: 1_000, absoluteMs: 5_000, stepUpMs: 500 });
    const idle = store.open('alice', 'operator');
    at = 900;
    expect(store.lookup(idle.token)).not.toBeNull();
    at = 2_000;
    expect(store.lookup(idle.token)).toBeNull();

    at = 10_000;
    const busy = store.open('alice', 'operator');
    for (let step = 1; step <= 5; step += 1) {
      at = 10_000 + step * 900;
      expect(store.lookup(busy.token)).not.toBeNull();
    }
    // Every gap is inside the idle time, so only the absolute limit can end this session.
    at = 10_000 + 6 * 900;
    expect(store.lookup(busy.token)).toBeNull();
  });

  it('is freshly stepped up for a few minutes only', () => {
    let at = 0;
    const store = new SessionStore(() => at, {
      idleMs: 60_000,
      absoluteMs: 600_000,
      stepUpMs: 1_000,
    });
    const { session } = store.open('alice', 'operator');
    expect(store.isSteppedUp(session)).toBe(false);
    store.stepUp(session);
    expect(store.isSteppedUp(session)).toBe(true);
    at = 1_001;
    expect(store.isSteppedUp(session)).toBe(false);
  });

  it('ends a session when it is closed', () => {
    const store = new SessionStore(() => 0);
    const { token } = store.open('alice', 'operator');
    store.close(token);
    expect(store.lookup(token)).toBeNull();
  });
});

describe('the sign-in guard', () => {
  it('locks a username after five failures in the window, until the lock ends', () => {
    let at = 0;
    const guard = new LoginGuard(() => at, 5, 60_000, 30_000);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      guard.failed('Alice');
    }
    expect(guard.locked('alice')).toBe(false);
    guard.failed('alice');
    expect(guard.locked('ALICE')).toBe(true);
    at = 30_001;
    expect(guard.locked('alice')).toBe(false);
  });

  it('forgets failures outside the window, and clears them on success', () => {
    let at = 0;
    const guard = new LoginGuard(() => at, 3, 1_000, 10_000);
    guard.failed('alice');
    guard.failed('alice');
    at = 2_000;
    guard.failed('alice');
    expect(guard.locked('alice')).toBe(false);
    guard.succeeded('alice');
    guard.failed('alice');
    guard.failed('alice');
    expect(guard.locked('alice')).toBe(false);
  });
});
