import { randomBytes } from 'node:crypto';

import type { LedgerLookup } from '../../../../packages/xrpl/src/reconcile.js';
import { type ApiContext, type WardenPort } from '../../src/server/api.js';
import { TESTNET_EXPLORER, type ReceiptLedger } from '../../src/server/receipt.js';
import { type Operator, operatorStoreOf } from '../../src/server/auth/operators.js';
import { hashPassword } from '../../src/server/auth/passwords.js';
import { LoginGuard, SessionStore } from '../../src/server/auth/sessions.js';

/*
 * Shared test setup for the console's API. Every secret and password is generated for each run, so no credential-looking
 * literal is written into the tests. The Warden is replaced by a fake that records each call.
 */

export const START_MS = Date.parse('2026-11-11T08:00:00.000Z');
const START_ISO = '2026-11-11T08:30:00.000Z';
const EXPIRES_ISO = '2026-11-12T08:30:00.000Z';
/** The request id the fake gives a raise that waits for a second operator. */
export const WAITING_REQUEST = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';

interface FakeLimits {
  perPaymentMinor: number;
  supplierDailyMinor: number;
  dailyTotalMinor: number;
}
export const PASSWORD = randomBytes(18).toString('base64url');
export const OPERATOR_NAME = 'alice';
export const SECOND_OPERATOR_NAME = 'bongani';
export const VIEWER_NAME = 'vera';

let hashed: Promise<string> | null = null;
function passwordHash(): Promise<string> {
  hashed ??= hashPassword(PASSWORD);
  return hashed;
}

function secret(): string {
  return randomBytes(32).toString('base64');
}

/** A Warden stand-in. It records each call, and it can be told to refuse with a status. */
export class FakeWarden implements WardenPort {
  readonly calls: string[] = [];
  refuseWith: number | null = null;
  overview: unknown = {
    paused: false,
    policyVersion: '2026-11-10.1',
    limits: { perPaymentMinor: 500000, supplierDailyMinor: 1000000, dailyTotalMinor: 2000000 },
    usageToday: { day: '2026-11-11', totalMinor: 120000 },
    pendingLimitChange: null,
  };
  proposals: unknown = { proposals: [] };
  suppliers: unknown = { suppliers: [] };

  opsOverview(): Promise<unknown> {
    return this.answer('overview', this.overview);
  }

  opsProposals(): Promise<unknown> {
    return this.answer('proposals', this.proposals);
  }

  opsProposal(attemptId: string): Promise<unknown> {
    const list = (
      this.proposals as { readonly proposals: readonly { readonly attemptId: string }[] }
    ).proposals;
    const found = list.find((item) => item.attemptId === attemptId);
    if (found === undefined) {
      return this.answer(`proposal:${attemptId}`, undefined, 404);
    }
    return this.answer(`proposal:${attemptId}`, found);
  }

  opsSuppliers(): Promise<unknown> {
    return this.answer('suppliers', this.suppliers);
  }

  setPaused(paused: boolean): Promise<unknown> {
    // Like the Warden, the overview reflects the pause from now on.
    this.overview = { ...(this.overview as Record<string, unknown>), paused };
    return this.answer(`pause:${String(paused)}`, { paused });
  }

  /** Like the Warden: a lowering applies at once; a raise waits for a second operator, and its requester is someone else. */
  setLimits(patch: unknown): Promise<unknown> {
    const current = (this.overview as { readonly limits: FakeLimits }).limits;
    const values = patch as Partial<FakeLimits>;
    const next: FakeLimits = {
      perPaymentMinor: values.perPaymentMinor ?? current.perPaymentMinor,
      supplierDailyMinor: values.supplierDailyMinor ?? current.supplierDailyMinor,
      dailyTotalMinor: values.dailyTotalMinor ?? current.dailyTotalMinor,
    };
    const raises =
      next.perPaymentMinor > current.perPaymentMinor ||
      next.supplierDailyMinor > current.supplierDailyMinor ||
      next.dailyTotalMinor > current.dailyTotalMinor;
    if (raises) {
      this.overview = {
        ...(this.overview as object),
        pendingLimitChange: {
          requestId: WAITING_REQUEST,
          requestedBy: 'operator-someone-else',
          requestedAt: START_ISO,
          expiresAt: EXPIRES_ISO,
          ...next,
        },
      };
      return this.answer(`limits:${JSON.stringify(patch)}`, {
        applied: false,
        requestId: WAITING_REQUEST,
        expiresAt: EXPIRES_ISO,
      });
    }
    this.overview = { ...(this.overview as object), limits: next };
    return this.answer(`limits:${JSON.stringify(patch)}`, {
      applied: true,
      policyVersion: '2026-11-11.1',
    });
  }

  approveLimits(requestId: string): Promise<unknown> {
    const overview = this.overview as {
      readonly pendingLimitChange: (FakeLimits & { readonly requestId: string }) | null;
    };
    const pending = overview.pendingLimitChange;
    if (pending?.requestId !== requestId) {
      return this.answer(`approve:${requestId}`, undefined, 404);
    }
    this.overview = {
      ...(this.overview as object),
      limits: {
        perPaymentMinor: pending.perPaymentMinor,
        supplierDailyMinor: pending.supplierDailyMinor,
        dailyTotalMinor: pending.dailyTotalMinor,
      },
      pendingLimitChange: null,
    };
    return this.answer(`approve:${requestId}`, { policyVersion: '2026-11-11.2' });
  }

  private answer(call: string, body: unknown, status: number | null = null): Promise<unknown> {
    this.calls.push(call);
    const refusal = status ?? this.refuseWith;
    if (refusal !== null) {
      return Promise.reject(Object.assign(new Error('the Warden refused'), { status: refusal }));
    }
    return Promise.resolve(body);
  }
}

/** The test token's issuer. A placeholder address: it is compared, never sent anywhere. */
export const TOKEN_ISSUER = 'rTokenIssuerForTests0000000';

/** A ledger stand-in for receipts. It answers with what a test sets, or fails when set to an error. */
export class FakeLedger implements ReceiptLedger {
  answer: LedgerLookup | Error = { status: 'not-validated' };
  readonly hashes: string[] = [];

  lookup(hash: string): Promise<LedgerLookup> {
    this.hashes.push(hash);
    return this.answer instanceof Error
      ? Promise.reject(this.answer)
      : Promise.resolve(this.answer);
  }
}

export interface Harness {
  readonly ctx: ApiContext;
  readonly warden: FakeWarden;
  readonly ledger: FakeLedger;
  /** The origins a page may come from. A test adds the address of its server here once it is listening. */
  readonly origins: Set<string>;
  advance(ms: number): void;
  operatorsByName(): {
    readonly operator: Operator;
    readonly second: Operator;
    readonly viewer: Operator;
  };
}

/** A context with two operators (each with a Warden principal) and one viewer, over a fake Warden. */
export async function harnessOf(transitionsPath: string): Promise<Harness> {
  const hash = await passwordHash();
  const operators = operatorStoreOf([
    {
      username: OPERATOR_NAME,
      role: 'operator',
      passwordHash: hash,
      wardenPrincipal: 'operator-alice',
      wardenSecret: secret(),
    },
    {
      username: SECOND_OPERATOR_NAME,
      role: 'operator',
      passwordHash: hash,
      wardenPrincipal: 'operator-bongani',
      wardenSecret: secret(),
    },
    {
      username: VIEWER_NAME,
      role: 'viewer',
      passwordHash: hash,
      wardenPrincipal: null,
      wardenSecret: null,
    },
  ]);
  let clockMs = START_MS;
  const warden = new FakeWarden();
  const ledger = new FakeLedger();
  const origins = new Set<string>();
  const ctx: ApiContext = {
    operators,
    sessions: new SessionStore(() => clockMs),
    guard: new LoginGuard(() => clockMs),
    transitionsPath,
    allowedOrigins: origins,
    version: '0.1.0',
    mode: 'live',
    wardenFor: () => warden,
    now: () => new Date(clockMs),
    ledger,
    receipts: {
      tokenIssuer: TOKEN_ISSUER,
      rlusdIssuer: null,
      explorerBase: TESTNET_EXPLORER,
      demoRandPerUnit: '18.50',
    },
  };
  return {
    ctx,
    warden,
    ledger,
    origins,
    advance: (ms) => {
      clockMs += ms;
    },
    operatorsByName: () => {
      const find = (name: string): Operator => {
        const found = operators.find(name);
        if (found === undefined) {
          throw new Error(`the test operator ${name} is missing`);
        }
        return found;
      };
      return {
        operator: find(OPERATOR_NAME),
        second: find(SECOND_OPERATOR_NAME),
        viewer: find(VIEWER_NAME),
      };
    },
  };
}

/** The JSON in an answer, or null when there is none or it is not JSON. */
function jsonOf(text: string): unknown {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface Reply {
  readonly status: number;
  readonly json: unknown;
  readonly text: string;
  readonly setCookie: string | null;
}

export interface Call {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly csrf?: string;
  readonly origin?: string;
}

/** One request to the console. The body, if any, is sent as JSON. */
export async function call(base: string, path: string, options: Call = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.cookie !== undefined) {
    headers['cookie'] = options.cookie;
  }
  if (options.csrf !== undefined) {
    headers['x-signoff-csrf'] = options.csrf;
  }
  if (options.origin !== undefined) {
    headers['origin'] = options.origin;
  }
  const response = await fetch(new URL(path, base), {
    method: options.method ?? 'GET',
    headers,
    redirect: 'manual',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: jsonOf(text),
    text,
    setCookie: response.headers.get('set-cookie'),
  };
}

/** Signs in and returns the session cookie and the form token the page would hold. */
export async function signIn(
  base: string,
  username: string,
  password: string = PASSWORD,
): Promise<{ readonly cookie: string; readonly csrf: string }> {
  const reply = await call(base, '/api/session', { method: 'POST', body: { username, password } });
  const cookie = (reply.setCookie ?? '').split(';')[0] ?? '';
  const csrf = (reply.json as { readonly csrfToken?: string } | null)?.csrfToken ?? '';
  return { cookie, csrf };
}
