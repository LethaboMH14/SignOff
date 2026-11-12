import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConsoleServer } from '../src/server/app.js';
import { call, type Harness, harnessOf, OPERATOR_NAME, signIn } from './helpers/api.js';

/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */

const CORRELATION = 'a'.repeat(64);

function line(seq: number, toState: string): string {
  return JSON.stringify({
    seq,
    at: `2026-11-11T09:0${String(seq)}:00.000Z`,
    correlationId: CORRELATION,
    obligationKey: 'd'.repeat(64),
    fromState: null,
    toState,
    actor: 'matcher',
    reasonCode: 'OK',
    reasons: [],
    policyVersion: '2026-11-10.1',
    attemptId: null,
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
  directory = mkdtempSync(join(tmpdir(), 'console-poll-'));
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
    [line(1, 'RECEIVED'), line(2, 'EXTRACTED'), line(3, 'HELD')].join('\n') + '\n',
  );
  const harness = await harnessOf(path);
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

describe('the polled log', () => {
  it('needs a signed-in session', async () => {
    const { url } = await start();
    expect((await call(url, '/api/transitions?after=0')).status).toBe(401);
  });

  it('returns only the moves after the last sequence number the browser has', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const all = await call(url, '/api/transitions?after=0', { cookie: session.cookie });
    expect(all.status).toBe(200);
    expect(all.json).toMatchObject({ mode: 'simulated', damaged: 0 });
    expect(
      (all.json as { readonly events: readonly { readonly seq: number }[] }).events.map(
        (e) => e.seq,
      ),
    ).toEqual([1, 2, 3]);
    const later = await call(url, '/api/transitions?after=2', { cookie: session.cookie });
    expect(
      (later.json as { readonly events: readonly { readonly seq: number }[] }).events.map(
        (e) => e.seq,
      ),
    ).toEqual([3]);
    const caughtUp = await call(url, '/api/transitions?after=3', { cookie: session.cookie });
    expect((caughtUp.json as { readonly events: unknown[] }).events).toEqual([]);
  });

  it('sends the whole log again when it starts again at a lower sequence number', async () => {
    const { url } = await start();
    const session = await signIn(url, OPERATOR_NAME);
    const restarted = await call(url, '/api/transitions?after=9', { cookie: session.cookie });
    expect(
      (restarted.json as { readonly events: readonly { readonly seq: number }[] }).events.map(
        (e) => e.seq,
      ),
    ).toEqual([1, 2, 3]);
  });
});
