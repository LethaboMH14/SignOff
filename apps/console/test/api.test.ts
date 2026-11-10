/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConsoleServer } from '../src/server/app.js';
import {
  call,
  type Harness,
  harnessOf,
  OPERATOR_NAME,
  PASSWORD,
  SECOND_OPERATOR_NAME,
  signIn,
  VIEWER_NAME,
} from './helpers/api.js';

const ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const CORRELATION = 'a'.repeat(64);
const LEDGER_HASH = 'F'.repeat(64);
const SECRET_BLOB = 'SECRET-BLOB-MARKER';
const WRONG_PASSWORD = 'not-the-password-at-all';

function transitionLine(seq: number, toState: string, attemptId: string | null): string {
  return JSON.stringify({
    seq,
    at: `2026-11-11T09:0${String(seq)}:00.000Z`,
    correlationId: CORRELATION,
    obligationKey: 'd'.repeat(64),
    fromState: null,
    toState,
    actor: toState === 'RECONCILED' ? 'reconciler' : 'intake',
    reasonCode: 'OK',
    reasons: ['a reason the browser must not see'],
    policyVersion: '2026-11-10.1',
    attemptId,
    ledgerHash: toState === 'RECONCILED' ? LEDGER_HASH : null,
    evidence: {
      fileSha256: 'e'.repeat(64),
      recordSha256s: [],
      quoteSha256s: [],
      model: null,
      modelCalls: 0,
      screenCodes: [],
    },
  });
}

let directory = '';
const servers: Server[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'console-api-'));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((closed) => {
          server.close(() => {
            closed();
          });
        }),
    ),
  );
  rmSync(directory, { recursive: true, force: true });
});

/** A console with one paid invoice in the agent's log, and a Warden that has paid the same attempt. */
async function start(): Promise<{ url: string; harness: Harness }> {
  const path = join(directory, 'agent-log.jsonl');
  writeFileSync(
    path,
    `${transitionLine(1, 'RECEIVED', null)}\n${transitionLine(2, 'RECONCILED', ATTEMPT)}\n`,
  );
  const harness = await harnessOf(path);
  harness.warden.overview = {
    ...(harness.warden.overview as Record<string, unknown>),
    pendingLimitChange: null,
  };
  harness.warden.proposals = {
    proposals: [
      {
        attemptId: ATTEMPT,
        decision: 'ALLOW',
        policyVersion: '2026-11-10.1',
        evaluatedAt: '2026-11-11T09:00:00.000Z',
        reasons: [],
        payment: {
          status: 'paid',
          attemptNumber: 1,
          obligationKey: 'd'.repeat(64),
          supplierId: 'SUP-ABCD1234',
          currency: 'USD',
          ledgerCurrency: 'USD',
          amountMinor: 125000,
          createdAt: '2026-11-11T09:00:00.000Z',
          ledgerIndex: 99,
          engineResult: 'tesSUCCESS',
          transactionHash: LEDGER_HASH,
          wardenBlob: SECRET_BLOB,
          txFields: { Amount: SECRET_BLOB },
        },
      },
    ],
  };
  const server = createConsoleServer({
    transitionsPath: path,
    mode: 'simulated',
    pollMs: 20,
    staticDir: null,
    api: harness.ctx,
  });
  servers.push(server);
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  harness.origins.add(url);
  return { url, harness };
}

async function stepUpFor(url: string, cookie: string, csrf: string): Promise<void> {
  const reply = await call(url, '/api/session/step-up', {
    method: 'POST',
    cookie,
    csrf,
    origin: url,
    body: { password: PASSWORD },
  });
  expect(reply.status).toBe(200);
}

describe('signing in', () => {
  it('gives the same refusal for an unknown name and a wrong password', async () => {
    const { url } = await start();
    const unknown = await call(url, '/api/session', {
      method: 'POST',
      body: { username: 'nobody-here', password: WRONG_PASSWORD },
    });
    const wrong = await call(url, '/api/session', {
      method: 'POST',
      body: { username: OPERATOR_NAME, password: WRONG_PASSWORD },
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.json).toEqual({ error: 'sign-in failed' });
    expect(wrong.json).toEqual({ error: 'sign-in failed' });
    expect(unknown.setCookie).toBeNull();
  });

  it('sets an HttpOnly, strict cookie and gives the form token for a correct password', async () => {
    const { url } = await start();
    const reply = await call(url, '/api/session', {
      method: 'POST',
      body: { username: OPERATOR_NAME, password: PASSWORD },
    });
    expect(reply.status).toBe(200);
    expect(reply.setCookie).toMatch(
      /^signoff_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/,
    );
    expect(reply.json).toMatchObject({ username: OPERATOR_NAME, role: 'operator', stepUp: false });
    expect(reply.text).not.toContain(PASSWORD);
  });

  it('refuses a caller after five wrong passwords, even with the right one', async () => {
    const { url } = await start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await call(url, '/api/session', {
        method: 'POST',
        body: { username: OPERATOR_NAME, password: WRONG_PASSWORD },
      });
    }
    const locked = await call(url, '/api/session', {
      method: 'POST',
      body: { username: OPERATOR_NAME, password: PASSWORD },
    });
    expect(locked.status).toBe(429);
  });

  it('refuses a request body that is not JSON, or has a field it does not know', async () => {
    const { url } = await start();
    const notJson = await fetch(`${url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(notJson.status).toBe(400);
    const unknownField = await call(url, '/api/session', {
      method: 'POST',
      body: { username: OPERATOR_NAME, password: PASSWORD, role: 'operator' },
    });
    expect(unknownField.status).toBe(400);
  });
});

describe('the desk', () => {
  it('refuses an unauthenticated request', async () => {
    const { url } = await start();
    const reply = await call(url, '/api/desk');
    expect(reply.status).toBe(401);
    expect(reply.json).toEqual({ error: 'sign in to continue' });
  });

  it('shows Paid for the reconciled, validated attempt, with no signed or transaction fields', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, '/api/desk', { cookie: session.cookie });
    expect(reply.status).toBe(200);
    const body = reply.json as {
      rows: { displayState: string; attemptId: string; reason: string }[];
      counts: Record<string, number>;
      overview: { paused: boolean };
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ displayState: 'Paid', attemptId: ATTEMPT });
    expect(body.counts['Paid']).toBe(1);
    expect(body.overview.paused).toBe(false);
    for (const secret of [
      SECRET_BLOB,
      'wardenBlob',
      'txFields',
      'finalBlob',
      'passwordHash',
      'wardenSecret',
      LEDGER_HASH,
      'a reason the browser must not see',
      'evidence',
    ]) {
      expect(reply.text).not.toContain(secret);
    }
  });

  it('is open to a viewer for reading, and refused to a caller whose session has ended', async () => {
    const { url } = await start();
    const viewer = await signIn(url, VIEWER_NAME);
    expect((await call(url, '/api/desk', { cookie: viewer.cookie })).status).toBe(200);
    const closed = await call(url, '/api/session', {
      method: 'DELETE',
      cookie: viewer.cookie,
      csrf: viewer.csrf,
      origin: url,
    });
    expect(closed.status).toBe(204);
    expect((await call(url, '/api/desk', { cookie: viewer.cookie })).status).toBe(401);
  });

  it('reports a Warden that will not answer as a Warden failure, not as a payment state', async () => {
    const { url, harness } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    harness.warden.refuseWith = 500;
    const reply = await call(url, '/api/desk', { cookie: session.cookie });
    expect(reply.status).toBe(502);
    expect(reply.json).toEqual({ error: 'the Warden did not answer' });
  });
});

describe('the changes', () => {
  it('refuses a pause from a viewer, and says so', async () => {
    const { url } = await start();
    const viewer = await signIn(url, VIEWER_NAME);
    const reply = await call(url, '/api/control/pause', {
      method: 'POST',
      cookie: viewer.cookie,
      csrf: viewer.csrf,
      origin: url,
      body: { paused: true },
    });
    expect(reply.status).toBe(403);
    expect(reply.json).toEqual({ error: 'this account cannot change the Warden' });
  });

  it('refuses a pause without the form token, with a wrong one, or from another origin', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    const base = { method: 'POST', cookie: operator.cookie, body: { paused: true } };
    expect((await call(url, '/api/control/pause', { ...base, origin: url })).status).toBe(403);
    expect(
      (
        await call(url, '/api/control/pause', {
          ...base,
          origin: url,
          csrf: 'wrong-token-value-here',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(url, '/api/control/pause', {
          ...base,
          origin: 'https://evil.example',
          csrf: operator.csrf,
        })
      ).status,
    ).toBe(403);
    expect(harness.warden.calls).toEqual([]);
  });

  it('refuses a pause without a recent step-up, and sends nothing to the Warden', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, '/api/control/pause', {
      method: 'POST',
      cookie: operator.cookie,
      csrf: operator.csrf,
      origin: url,
      body: { paused: true },
    });
    expect(reply.status).toBe(403);
    expect(reply.json).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(harness.warden.calls).toEqual([]);
  });

  it('refuses a wrong password at step-up, then pauses after the right one', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    const wrong = await call(url, '/api/session/step-up', {
      method: 'POST',
      cookie: operator.cookie,
      csrf: operator.csrf,
      origin: url,
      body: { password: WRONG_PASSWORD },
    });
    expect(wrong.status).toBe(401);
    await stepUpFor(url, operator.cookie, operator.csrf);
    const paused = await call(url, '/api/control/pause', {
      method: 'POST',
      cookie: operator.cookie,
      csrf: operator.csrf,
      origin: url,
      body: { paused: true },
    });
    expect(paused.status).toBe(200);
    expect(harness.warden.calls).toEqual(['pause:true']);
  });

  it('sends a limit change only with a step-up, and refuses an empty change', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    await stepUpFor(url, operator.cookie, operator.csrf);
    const empty = await call(url, '/api/limits', {
      method: 'POST',
      cookie: operator.cookie,
      csrf: operator.csrf,
      origin: url,
      body: {},
    });
    expect(empty.status).toBe(400);
    const lowered = await call(url, '/api/limits', {
      method: 'POST',
      cookie: operator.cookie,
      csrf: operator.csrf,
      origin: url,
      body: { perPaymentMinor: 250000 },
    });
    expect(lowered.status).toBe(200);
    expect(harness.warden.calls).toEqual(['limits:{"perPaymentMinor":250000}']);
  });

  it('lets a second person approve a waiting raise, and passes the Warden refusal on in its own words', async () => {
    const { url, harness } = await start();
    const second = await signIn(url, SECOND_OPERATOR_NAME);
    await stepUpFor(url, second.cookie, second.csrf);
    const requestId = '1d2e3f40-5a6b-4c7d-8e9f-a0b1c2d3e4f5';
    const approved = await call(url, `/api/limits/${requestId}/approve`, {
      method: 'POST',
      cookie: second.cookie,
      csrf: second.csrf,
      origin: url,
    });
    expect(approved.status).toBe(200);
    expect(harness.warden.calls).toEqual([`approve:${requestId}`]);
    harness.warden.refuseWith = 409;
    const refused = await call(url, `/api/limits/${requestId}/approve`, {
      method: 'POST',
      cookie: second.cookie,
      csrf: second.csrf,
      origin: url,
    });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ error: 'the Warden refused' });
  });

  it('refuses an approval whose request id is not in the expected form', async () => {
    const { url } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    await stepUpFor(url, operator.cookie, operator.csrf);
    const reply = await call(url, '/api/limits/not-an-id/approve', {
      method: 'POST',
      cookie: operator.cookie,
      csrf: operator.csrf,
      origin: url,
    });
    expect(reply.status).toBe(404);
  });
});
