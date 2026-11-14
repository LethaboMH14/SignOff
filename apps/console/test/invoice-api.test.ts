/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConsoleServer } from '../src/server/app.js';
import { call, type Harness, harnessOf, OPERATOR_NAME, signIn } from './helpers/api.js';

const PAID = 'a'.repeat(64);
const HELD = 'b'.repeat(64);
const ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const ACCOUNT = 'rSupplierAccountForTestsWXYZ';
const AGENT_REASON = 'a reason the browser must not see';

function line(
  seq: number,
  correlationId: string,
  toState: string,
  reasonCode: string,
  attemptId: string | null,
  obligationKey: string,
): string {
  return JSON.stringify({
    seq,
    at: `2026-11-11T09:0${String(seq)}:00.000Z`,
    correlationId,
    obligationKey,
    fromState: null,
    toState,
    actor: toState === 'RECONCILED' ? 'reconciler' : 'matcher',
    reasonCode,
    reasons: [AGENT_REASON],
    policyVersion: '2026-11-10.1',
    attemptId,
    ledgerHash: toState === 'RECONCILED' ? 'F'.repeat(64) : null,
    evidence: {
      fileSha256: 'e'.repeat(64),
      recordSha256s: ['1'.repeat(64)],
      quoteSha256s: [],
      model: null,
      modelCalls: 2,
      screenCodes: [],
    },
  });
}

let directory = '';
const servers: Server[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'console-invoice-'));
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
      line(1, PAID, 'RECEIVED', 'OK', null, 'd'.repeat(64)),
      line(2, PAID, 'RECONCILED', 'OK', ATTEMPT, 'd'.repeat(64)),
      line(3, HELD, 'HELD', 'MISSING_EVIDENCE', null, 'e'.repeat(64)),
    ].join('\n') + '\n',
  );
  const harness = await harnessOf(path);
  harness.warden.proposals = {
    proposals: [
      {
        attemptId: ATTEMPT,
        decision: 'ALLOW',
        policyVersion: '2026-11-10.1',
        evaluatedAt: '2026-11-11T09:02:00.000Z',
        reasons: [],
        payment: {
          status: 'paid',
          attemptNumber: 1,
          obligationKey: 'd'.repeat(64),
          supplierId: 'SUP-ABCD1234',
          currency: 'USD',
          ledgerCurrency: 'USD',
          amountMinor: 125000,
          createdAt: '2026-11-11T09:02:00.000Z',
          ledgerIndex: 99,
          engineResult: 'tesSUCCESS',
          transactionHash: 'F'.repeat(64),
          wardenBlob: 'SECRET-BLOB-MARKER',
        },
      },
    ],
  };
  harness.warden.suppliers = {
    suppliers: [
      {
        supplierId: 'SUP-ABCD1234',
        status: 'active',
        payee: { address: ACCOUNT, destinationTag: null },
        enrolledBy: 'operator-one',
        approvedBy: 'operator-two',
        change: {
          changeId: 'change-1',
          status: 'requested',
          requestedAt: '2026-11-11T08:00:00.000Z',
          coolingOffUntil: null,
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

describe('the held-invoice view over the API', () => {
  it('refuses a caller who has not signed in', async () => {
    const { url } = await start();
    expect((await call(url, `/api/invoices/${PAID}`)).status).toBe(401);
  });

  it('reports an invoice the log does not hold as not found', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/invoices/${'c'.repeat(64)}`, { cookie: session.cookie });
    expect(reply.status).toBe(404);
  });

  it('shows a paid invoice by its correlation id, with the enrolled account masked and no signed material', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/invoices/${PAID}`, { cookie: session.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      displayState: 'Paid',
      failedRule: null,
      nextAction: null,
      enrolledPayee: '…WXYZ',
      payoutChange: { status: 'requested', approvalAllowed: false },
    });
    expect(reply.text).not.toContain(ACCOUNT);
    expect(reply.text).not.toContain('SECRET-BLOB-MARKER');
    expect(reply.text).not.toContain(AGENT_REASON);
  });

  it('finds the same invoice by its attempt id', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/invoices/${ATTEMPT}`, { cookie: session.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ invoiceRef: 'aaaaaaaa', attemptId: ATTEMPT });
  });

  it('shows a held invoice with its failed rule, its next step, and no paid state', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const reply = await call(url, `/api/invoices/${HELD}`, { cookie: session.cookie });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      displayState: 'Held',
      failedRule: { code: 'MISSING_EVIDENCE' },
      nextAction: 'Link the purchase order or goods receipt, then propose the invoice again.',
      enrolledPayee: null,
      payoutChange: null,
    });
    expect(reply.text).not.toContain('"Paid"');
  });

  it('reports a Warden that will not answer as a Warden failure', async () => {
    const { url, harness } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    harness.warden.refuseWith = 500;
    const reply = await call(url, `/api/invoices/${PAID}`, { cookie: session.cookie });
    expect(reply.status).toBe(502);
  });
});
