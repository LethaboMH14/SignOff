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
  signIn,
  TOKEN_ISSUER,
} from './helpers/api.js';

const PAID_ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const HELD_ATTEMPT = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const PAID_CORRELATION = 'a'.repeat(64);
const HELD_CORRELATION = 'b'.repeat(64);
const HASH = 'F'.repeat(64);
const SECRET_BLOB = 'SECRET-BLOB-MARKER';

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
    ledgerHash: toState === 'RECONCILED' ? HASH : null,
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
  directory = mkdtempSync(join(tmpdir(), 'console-receipt-'));
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

async function start(): Promise<{ url: string; harness: Harness }> {
  const path = join(directory, 'agent-log.jsonl');
  writeFileSync(
    path,
    [
      line(1, PAID_CORRELATION, 'RECEIVED', null),
      line(2, PAID_CORRELATION, 'RECONCILED', PAID_ATTEMPT),
      line(3, HELD_CORRELATION, 'HELD', HELD_ATTEMPT),
    ].join('\n') + '\n',
  );
  const harness = await harnessOf(path);
  harness.warden.proposals = {
    proposals: [
      {
        attemptId: PAID_ATTEMPT,
        decision: 'ALLOW',
        policyVersion: '2026-11-10.1',
        evaluatedAt: '2026-11-11T09:02:00.000Z',
        reasons: [],
        payment: {
          status: 'paid',
          supplierId: 'SUP-ABCD1234',
          currency: 'USD',
          ledgerCurrency: 'TST',
          amountMinor: 125000,
          ledgerIndex: 99,
          engineResult: 'tesSUCCESS',
          transactionHash: HASH,
          wardenBlob: SECRET_BLOB,
        },
      },
      {
        attemptId: HELD_ATTEMPT,
        decision: 'HOLD',
        policyVersion: '2026-11-10.1',
        evaluatedAt: '2026-11-11T09:03:00.000Z',
        reasons: [{ code: 'PAUSED', message: 'payments are paused' }],
        payment: null,
      },
    ],
  };
  harness.ledger.answer = {
    status: 'validated',
    engineResult: 'tesSUCCESS',
    ledgerIndex: 99,
    delivered: { kind: 'iou', amount: { currency: 'TST', issuer: TOKEN_ISSUER, value: '1250.00' } },
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

describe('the receipt over the API', () => {
  it('refuses a caller who has not signed in', async () => {
    const { url } = await start();
    expect((await call(url, `/api/receipts/${PAID_ATTEMPT}`)).status).toBe(401);
  });

  it('reports a payment the log does not hold as not found', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    expect(
      (
        await call(url, '/api/receipts/1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b', {
          cookie: session.cookie,
        })
      ).status,
    ).toBe(404);
  });

  it('gives a receipt for a paid payment, after the ledger has confirmed it, with no signed material', async () => {
    const { url, harness } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/receipts/${PAID_ATTEMPT}`, { cookie: session.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      state: 'receipt',
      amount: '1250.00',
      currency: 'USD',
      asset: 'test-issued token, not RLUSD',
      deliveredValue: '1250.00',
      explorerUrl: `https://testnet.xrpl.org/transactions/${HASH}`,
      rand: { label: 'SIMULATED', rate: '18.50' },
    });
    expect(harness.ledger.hashes).toEqual([HASH]);
    expect(reply.text).not.toContain(SECRET_BLOB);
  });

  it('gives no receipt, and asks the ledger nothing, for a payment that is held', async () => {
    const { url, harness } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/receipts/${HELD_ATTEMPT}`, { cookie: session.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ state: 'not-paid' });
    expect(harness.ledger.hashes).toEqual([]);
  });

  it('says Not confirmed on the ledger when the ledger cannot be read, and gives no receipt', async () => {
    const { url, harness } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    harness.ledger.answer = new Error('connection refused');
    const reply = await call(url, `/api/receipts/${PAID_ATTEMPT}`, { cookie: session.cookie });
    expect(reply.json).toEqual({
      state: 'not-confirmed',
      message: 'Not confirmed on the ledger: the ledger could not be read.',
    });
  });
});
