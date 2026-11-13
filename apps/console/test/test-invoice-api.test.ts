/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiContext, TestInvoiceRequest } from '../src/server/api.js';
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
const PREPARED = 'INV-DEMO-20261113100000.pdf';
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.4 fictional'));

async function start(
  withPort: boolean,
): Promise<{ url: string; sent: number[]; requests: TestInvoiceRequest[] }> {
  const path = join(directory, 'agent-log.jsonl');
  writeFileSync(path, '');
  const harness = await harnessOf(path);
  const sent: number[] = [];
  const requests: TestInvoiceRequest[] = [];
  const ctx: ApiContext = withPort
    ? {
        ...harness.ctx,
        testInvoices: {
          send: (request) => {
            sent.push(request.zarMinor);
            requests.push(request);
            return Promise.resolve({
              invoiceNumber: 'INV-DEMO-1',
              usdMinor: 108,
              download: request.delivery === 'email' ? `/api/demo/outbox/${PREPARED}` : null,
            });
          },
          outboxFile: (name) => Promise.resolve(name === PREPARED ? PDF_BYTES : null),
          mailTo: 'signoff.demo@example.com',
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
  return { url, sent, requests };
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
    expect(reply.json).toEqual({ invoiceNumber: 'INV-DEMO-1', usdMinor: 108, download: null });
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

describe('an invoice to email', () => {
  it('prepares a clean or a bank-change invoice and returns its download path', async () => {
    const { url, requests } = await start(true);
    const reply = await send(url, OPERATOR_NAME, {
      zarMinor: 2000,
      delivery: 'email',
      variant: 'bank-change',
    });
    expect(reply.status).toBe(202);
    expect((reply.json as { download: string }).download).toBe(`/api/demo/outbox/${PREPARED}`);
    expect(requests).toEqual([{ zarMinor: 2000, delivery: 'email', variant: 'bank-change' }]);
  });

  it('defaults to the inbox and a clean invoice', async () => {
    const { url, requests } = await start(true);
    await send(url, OPERATOR_NAME, { zarMinor: 2000 });
    expect(requests).toEqual([{ zarMinor: 2000, delivery: 'inbox', variant: 'clean' }]);
  });

  it('refuses a delivery or a kind it does not know', async () => {
    const { url } = await start(true);
    expect((await send(url, OPERATOR_NAME, { zarMinor: 2000, delivery: 'sms' })).status).toBe(400);
    expect((await send(url, OPERATOR_NAME, { zarMinor: 2000, variant: 'other' })).status).toBe(400);
  });

  it('lets an operator download a prepared PDF as an attachment', async () => {
    const { url } = await start(true);
    const session = await signIn(url, OPERATOR_NAME);
    const response = await fetch(new URL(`/api/demo/outbox/${PREPARED}`, url), {
      headers: { cookie: session.cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(PDF_BYTES))).toBe(true);
  });

  it('refuses a viewer, a missing file and any name outside the pattern', async () => {
    const { url } = await start(true);
    const viewer = await signIn(url, VIEWER_NAME);
    const operator = await signIn(url, OPERATOR_NAME);
    expect(
      (await call(url, `/api/demo/outbox/${PREPARED}`, { cookie: viewer.cookie })).status,
    ).toBe(403);
    expect(
      (
        await call(url, '/api/demo/outbox/INV-DEMO-20991231235959.pdf', {
          cookie: operator.cookie,
        })
      ).status,
    ).toBe(404);
    for (const name of ['..%2F..%2Fwarden%2Fwarden-keys.json', 'console-password.txt', 'x.pdf']) {
      expect(
        (await call(url, `/api/demo/outbox/${name}`, { cookie: operator.cookie })).status,
      ).toBe(404);
    }
  });

  it('shows the mailbox address to operators only', async () => {
    const { url } = await start(true);
    const operator = await signIn(url, OPERATOR_NAME);
    const viewer = await signIn(url, VIEWER_NAME);
    const asOperator = await call(url, '/api/desk', { cookie: operator.cookie });
    const asViewer = await call(url, '/api/desk', { cookie: viewer.cookie });
    expect((asOperator.json as { mailTo?: string | null }).mailTo).toBe('signoff.demo@example.com');
    expect((asViewer.json as { mailTo?: string | null }).mailTo).toBeNull();
  });
});
