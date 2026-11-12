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
  signIn,
  WAITING_REQUEST,
} from './helpers/api.js';

/*
 * A simulated run never calls the Warden and never reads the ledger (S-058, S-059). The Warden fake records every call,
 * so these tests check that a replay makes none, and that no change can reach a Warden from a replay.
 */

const PAID_CORRELATION = 'a'.repeat(64);
const HELD_CORRELATION = 'b'.repeat(64);
const PAID_ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const REFUSAL = 'simulated mode: the Warden is not called, so nothing is changed.';

function line(
  seq: number,
  correlationId: string,
  toState: string,
  attemptId: string | null,
): string {
  return JSON.stringify({
    seq,
    at: `2026-11-11T09:0${String(seq)}:00.000Z`,
    correlationId,
    obligationKey: 'd'.repeat(64),
    fromState: null,
    toState,
    actor: toState === 'RECONCILED' ? 'reconciler' : 'matcher',
    reasonCode: toState === 'HELD' ? 'MISSING_EVIDENCE' : 'OK',
    reasons: [],
    policyVersion: '2026-11-10.1',
    attemptId,
    ledgerHash: null,
    evidence: {
      fileSha256: null,
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
  directory = mkdtempSync(join(tmpdir(), 'console-simulated-'));
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

/** A console in simulated mode over a replay log, with the Warden fake behind it. */
async function start(): Promise<{ url: string; harness: Harness }> {
  const path = join(directory, 'agent-log.jsonl');
  writeFileSync(
    path,
    [
      line(1, PAID_CORRELATION, 'RECEIVED', null),
      line(2, PAID_CORRELATION, 'RECONCILED', PAID_ATTEMPT),
      line(3, HELD_CORRELATION, 'HELD', null),
    ].join('\n') + '\n',
  );
  const harness = await harnessOf(path);
  const server = createConsoleServer({
    transitionsPath: path,
    mode: 'simulated',
    pollMs: 20,
    staticDir: null,
    api: { ...harness.ctx, mode: 'simulated' },
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
  await call(url, '/api/session/step-up', {
    method: 'POST',
    cookie,
    csrf,
    origin: url,
    body: { password: PASSWORD },
  });
}

describe('a simulated run', () => {
  it('shows the desk from the agent log alone, with no Warden overview, and never calls the Warden', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, '/api/desk', { cookie: operator.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ mode: 'simulated', overview: null });
    expect((reply.json as { readonly rows: readonly unknown[] }).rows).toHaveLength(2);
    expect(harness.warden.calls).toEqual([]);
  });

  it('refuses a pause, a limit change and an approval, even after a fresh step-up, and sends nothing', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    await stepUpFor(url, operator.cookie, operator.csrf);
    const base = { method: 'POST', cookie: operator.cookie, csrf: operator.csrf, origin: url };
    const pause = await call(url, '/api/control/pause', { ...base, body: { paused: true } });
    expect(pause.status).toBe(409);
    expect(pause.json).toEqual({ error: REFUSAL });
    const limits = await call(url, '/api/limits', { ...base, body: { perPaymentMinor: 100 } });
    expect(limits.status).toBe(409);
    expect(limits.json).toEqual({ error: REFUSAL });
    const approve = await call(url, `/api/limits/${WAITING_REQUEST}/approve`, base);
    expect(approve.status).toBe(409);
    expect(approve.json).toEqual({ error: REFUSAL });
    expect(harness.warden.calls).toEqual([]);
  });

  it('shows a held invoice from the log, with no Warden decision, and the Warden is not called', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/invoices/${HELD_CORRELATION}`, { cookie: operator.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ wardenDecision: null });
    expect(harness.warden.calls).toEqual([]);
  });

  it('gives no receipt, and calls neither the Warden nor the ledger, for a paid payment', async () => {
    const { url, harness } = await start();
    const operator = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/receipts/${PAID_ATTEMPT}`, { cookie: operator.cookie });
    expect(reply.json).toEqual({
      state: 'not-confirmed',
      message: 'Not confirmed on the ledger: simulated mode does not read the ledger.',
    });
    expect(harness.warden.calls).toEqual([]);
    expect(harness.ledger.hashes).toEqual([]);
  });
});
