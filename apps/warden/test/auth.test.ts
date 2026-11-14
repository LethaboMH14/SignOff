import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AuthError,
  RequestVerifier,
  signatureFor,
  signingText,
  type Principal,
  type SignedHeaders,
} from '../src/auth.js';

const START = new Date('2026-11-10T10:00:00.000Z');
const WINDOW_MS = 300_000;
const BODY = '{"a":1}';

// Generated for each run, so no secret-looking literal is written into the test.
const AGENT_SECRET = randomBytes(32);
const OPERATOR_SECRET = randomBytes(32);

const PRINCIPALS: ReadonlyMap<string, Principal> = new Map<string, Principal>([
  ['agent-1', { id: 'agent-1', role: 'agent', secret: AGENT_SECRET }],
  ['operator-a', { id: 'operator-a', role: 'operator', secret: OPERATOR_SECRET }],
]);

interface Clock {
  now: Date;
}

interface Signing {
  readonly secret?: Buffer;
  readonly principal?: string;
  readonly method?: string;
  readonly path?: string;
  readonly body?: string;
  readonly timestamp: string;
  readonly nonce: string;
}

/** The headers a caller sends for a request, signed the way the client signs them. */
function signed(input: Signing): SignedHeaders {
  const method = input.method ?? 'POST';
  const path = input.path ?? '/v1/proposals';
  const body = input.body ?? BODY;
  return {
    principal: input.principal ?? 'agent-1',
    timestamp: input.timestamp,
    nonce: input.nonce,
    signature: signatureFor(
      input.secret ?? AGENT_SECRET,
      signingText(method, path, input.timestamp, input.nonce, body),
    ),
  };
}

function verifierAt(clock: Clock, startedAt: Date = START): RequestVerifier {
  return new RequestVerifier(PRINCIPALS, () => clock.now, startedAt.getTime());
}

interface Check {
  readonly method?: string;
  readonly path?: string;
  readonly body?: string;
  readonly role?: 'agent' | 'operator';
}

/** Checks a request the way the server does: the route's role, method, path and body. */
function check(verifier: RequestVerifier, headers: SignedHeaders | null, options: Check = {}) {
  return verifier.verify({
    method: options.method ?? 'POST',
    path: options.path ?? '/v1/proposals',
    headers,
    body: options.body ?? BODY,
    role: options.role ?? 'agent',
  });
}

describe('request authentication', () => {
  it('accepts a correctly signed request and returns its principal', () => {
    const headers = signed({ timestamp: START.toISOString(), nonce: 'nonce-accept-0001' });
    expect(check(verifierAt({ now: START }), headers).id).toBe('agent-1');
  });

  it('refuses a request with no authentication headers', () => {
    expect(() => check(verifierAt({ now: START }), null)).toThrow(
      new AuthError('authentication required'),
    );
  });

  it('refuses an unknown principal, and a principal presented on a route for the other role', () => {
    const verifier = verifierAt({ now: START });
    const headers = signed({ timestamp: START.toISOString(), nonce: 'nonce-role-0001' });
    expect(() => check(verifier, { ...headers, principal: 'nobody' })).toThrow(
      new AuthError('authentication failed'),
    );
    expect(() => check(verifier, headers, { role: 'operator' })).toThrow(
      new AuthError('authentication failed'),
    );
  });

  it("refuses a signature made with another caller's secret", () => {
    const headers = signed({
      secret: OPERATOR_SECRET,
      timestamp: START.toISOString(),
      nonce: 'nonce-wrong-0001',
    });
    expect(() => check(verifierAt({ now: START }), headers)).toThrow(AuthError);
  });

  it('refuses a request whose body, path or method differs from what was signed', () => {
    const verifier = verifierAt({ now: START });
    const headers = signed({ timestamp: START.toISOString(), nonce: 'nonce-tamper-0001' });
    expect(() => check(verifier, headers, { body: '{"a":2}' })).toThrow(AuthError);
    expect(() => check(verifier, headers, { path: '/v1/control/pause' })).toThrow(AuthError);
    expect(() => check(verifier, headers, { method: 'PUT' })).toThrow(AuthError);
    // A refused request does not use up its nonce, so the genuine request still passes afterwards.
    expect(check(verifier, headers).id).toBe('agent-1');
  });

  it('refuses a timestamp outside the five-minute window in either direction, and a timestamp that is not a date', () => {
    const clock = { now: new Date(START.getTime() + 3_600_000) };
    const verifier = verifierAt(clock);
    const stale = new Date(clock.now.getTime() - WINDOW_MS - 1000).toISOString();
    const future = new Date(clock.now.getTime() + WINDOW_MS + 1000).toISOString();
    expect(() => check(verifier, signed({ timestamp: stale, nonce: 'nonce-stale-0001' }))).toThrow(
      AuthError,
    );
    expect(() =>
      check(verifier, signed({ timestamp: future, nonce: 'nonce-future-0001' })),
    ).toThrow(AuthError);
    expect(() =>
      check(verifier, signed({ timestamp: 'yesterday', nonce: 'nonce-date-0001' })),
    ).toThrow(AuthError);
  });

  it('accepts a timestamp exactly at the edge of the window', () => {
    const clock = { now: new Date(START.getTime() + 3_600_000) };
    const edge = new Date(clock.now.getTime() - WINDOW_MS).toISOString();
    expect(check(verifierAt(clock), signed({ timestamp: edge, nonce: 'nonce-edge-0001' })).id).toBe(
      'agent-1',
    );
  });

  it('refuses a request that is replayed with the same nonce', () => {
    const verifier = verifierAt({ now: START });
    const headers = signed({ timestamp: START.toISOString(), nonce: 'nonce-replay-0002' });
    expect(check(verifier, headers).id).toBe('agent-1');
    expect(() => check(verifier, headers)).toThrow(new AuthError('authentication failed'));
  });

  it('keeps nonces apart for each principal', () => {
    const verifier = verifierAt({ now: START });
    const agent = signed({ timestamp: START.toISOString(), nonce: 'nonce-scope-0001' });
    const operator = signed({
      principal: 'operator-a',
      secret: OPERATOR_SECRET,
      path: '/v1/control/pause',
      body: '{}',
      timestamp: START.toISOString(),
      nonce: 'nonce-scope-0001',
    });
    expect(check(verifier, agent).id).toBe('agent-1');
    expect(
      check(verifier, operator, { role: 'operator', path: '/v1/control/pause', body: '{}' }).id,
    ).toBe('operator-a');
  });

  it('refuses a request sent before this process started, even inside the window', () => {
    const startedAt = new Date(START.getTime() + 60_000);
    const verifier = verifierAt({ now: new Date(START.getTime() + 90_000) }, startedAt);
    const sentBeforeStart = signed({
      timestamp: new Date(START.getTime() + 30_000).toISOString(),
      nonce: 'nonce-restart-0001',
    });
    expect(() => check(verifier, sentBeforeStart)).toThrow(new AuthError('authentication failed'));
  });

  it('accepts a request sent at the moment this process started', () => {
    const startedAt = new Date(START.getTime() + 60_000);
    const verifier = verifierAt({ now: new Date(START.getTime() + 90_000) }, startedAt);
    const atStart = signed({ timestamp: startedAt.toISOString(), nonce: 'nonce-restart-0002' });
    expect(check(verifier, atStart).id).toBe('agent-1');
  });

  it('forgets a nonce once it can no longer be replayed, and keeps accepting new requests', () => {
    const clock = { now: START };
    const verifier = verifierAt(clock);
    check(verifier, signed({ timestamp: START.toISOString(), nonce: 'nonce-prune-0001' }));
    clock.now = new Date(START.getTime() + 2 * WINDOW_MS + 1000);
    const later = signed({ timestamp: clock.now.toISOString(), nonce: 'nonce-prune-0002' });
    expect(check(verifier, later).id).toBe('agent-1');
  });
});
