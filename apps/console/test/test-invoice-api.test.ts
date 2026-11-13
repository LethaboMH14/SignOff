/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiContext } from '../src/server/api.js';
import { createConsoleServer } from '../src/server/app.js';
import { call, harnessOf, OPERATOR_NAME, signIn, VIEWER_NAME } from './helpers/api.js';

let directory = '';
const servers: Server[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'console-test-invoice-'));
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

/** A console whose test invoice port records each amount, or no port at all. */
async function start(withPort: boolean): Promise<{ url: string; sent: number[] }> {
  const path = join(directory, 'agent-log.jsonl');
  writeFileSync(path, '');
  const harness = await harnessOf(path);
  const sent: number[] = [];
  const ctx: ApiContext = withPort
    ? {
        ...harness.ctx,
        testInvoices: {
          send: (zarMinor) => {
            sent.push(zarMinor);
            return Promise.resolve({ invoiceNumber: 'INV-DEMO-1', usdMinor: 108 });
          },
        },
      }
    : harness.ctx;
  const server = createConsoleServer({
    transitionsPath: path,
    mode: 'simulated',
    pollMs: 20,
    staticDir: null,
    api: ctx,
  });
  servers.push(server);
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  harness.origins.add(url);
  return { url, sent };
}

async function send(url: string, who: string, body: unknown) {
  const session = await signIn(url, who);
  return call(url, '/api/demo/invoice', {
    method: 'POST',
    body,
    cookie: session.cookie,
    csrf: session.csrf,
    origin: url,
  });
}

describe('the test invoice route', () => {
  it('drops an invoice for an operator when the demo launcher turned it on', async () => {
    const { url, sent } = await start(true);
    const reply = await send(url, OPERATOR_NAME, { zarMinor: 2000 });
    expect(reply.status).toBe(202);
    expect(reply.json).toEqual({ invoiceNumber: 'INV-DEMO-1', usdMinor: 108 });
    expect(sent).toEqual([2000]);
  });

  it('is not there when the console was started without the demo launcher', async () => {
    const { url } = await start(false);
    const reply = await send(url, OPERATOR_NAME, { zarMinor: 2000 });
    expect(reply.status).toBe(404);
  });

  it('refuses a viewer', async () => {
    const { url, sent } = await start(true);
    const reply = await send(url, VIEWER_NAME, { zarMinor: 2000 });
    expect(reply.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('refuses an amount outside R1 to R10,000, or a body with extra fields', async () => {
    const { url, sent } = await start(true);
    expect((await send(url, OPERATOR_NAME, { zarMinor: 50 })).status).toBe(400);
    expect((await send(url, OPERATOR_NAME, { zarMinor: 2_000_000 })).status).toBe(400);
    expect((await send(url, OPERATOR_NAME, { zarMinor: 2000, to: 'rAnyone' })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('refuses a caller who is not signed in', async () => {
    const { url } = await start(true);
    const reply = await call(url, '/api/demo/invoice', {
      method: 'POST',
      body: { zarMinor: 2000 },
      origin: url,
    });
    expect(reply.status).toBe(401);
  });
});
