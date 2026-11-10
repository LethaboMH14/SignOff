/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConsoleServer } from '../src/server/app.js';

const HASH = 'c'.repeat(64);

function lineOf(seq: number, toState = 'RECEIVED'): string {
  return JSON.stringify({
    seq,
    at: '2026-11-10T10:00:00.000Z',
    correlationId: HASH,
    obligationKey: 'd'.repeat(64),
    fromState: null,
    toState,
    actor: 'intake',
    reasonCode: 'OK',
    reasons: ['a reason the browser must not see'],
    policyVersion: '2026-11-10.1',
    attemptId: null,
    ledgerHash: null,
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
  directory = mkdtempSync(join(tmpdir(), 'console-app-'));
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

async function start(
  lines: string,
  staticDir: string | null = null,
): Promise<{ url: string; path: string }> {
  const path = join(directory, 'agent-log.jsonl');
  writeFileSync(path, lines);
  const server = createConsoleServer({
    transitionsPath: path,
    mode: 'simulated',
    pollMs: 20,
    staticDir,
  });
  servers.push(server);
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, path };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for the stream'));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('the stream failed'));
      },
    );
  });
}

/** Reads the event stream until the text received so far satisfies the condition. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  done: (text: string) => boolean,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 4000;
  try {
    while (!done(text)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('timed out waiting for the stream');
      }
      const chunk = await withTimeout(reader.read(), remaining);
      if (chunk.done) {
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function connect(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { headers, signal: AbortSignal.timeout(5000) });
}

describe('the console server', () => {
  it('answers the health check with the mode, and nothing that is not a GET', async () => {
    const { url } = await start('');
    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', mode: 'simulated' });
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(health.headers.get('cache-control')).toBe('no-store');
    const post = await fetch(`${url}/api/health`, { method: 'POST' });
    expect(post.status).toBe(405);
  });

  it('answers unknown paths with not found', async () => {
    const { url } = await start('');
    const response = await fetch(`${url}/nowhere`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });

  it('serves the built web app, and never a file outside its folder', async () => {
    const web = join(directory, 'web');
    mkdirSync(web);
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>page</title>');
    writeFileSync(join(directory, 'secret.txt'), 'do not serve');
    const { url } = await start('', web);
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(await page.text()).toContain('<title>page</title>');
    const escaped = await fetch(`${url}/%2e%2e/secret.txt`);
    expect(escaped.status).toBe(404);
    expect(await escaped.text()).not.toContain('do not serve');
    const malformed = await fetch(`${url}/%E0%A4%A`);
    expect(malformed.status).toBe(404);
  });

  it('streams the whole log first, then each new line, without the evidence or the reasons', async () => {
    const { url, path } = await start(`${lineOf(1)}\n`);
    const controller = new AbortController();
    const response = await fetch(`${url}/api/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = response.body;
    if (body === null) {
      throw new Error('the stream has no body');
    }
    const first = await readUntil(body, (text) => text.includes('id: 1\n'));
    expect(first).toContain('event: hello');
    expect(first).toContain('event: transition');
    expect(first).toContain('"toState":"RECEIVED"');
    expect(first).not.toContain('evidence');
    expect(first).not.toContain('a reason the browser must not see');
    expect(first).not.toContain('obligationKey');
    appendFileSync(path, `${lineOf(2, 'EXTRACTED')}\n`);
    const second = await connect(`${url}/api/events`, { 'last-event-id': '1' });
    const secondBody = second.body;
    if (secondBody === null) {
      throw new Error('the stream has no body');
    }
    const resumed = await readUntil(secondBody, (text) => text.includes('id: 2\n'));
    expect(resumed).toContain('"toState":"EXTRACTED"');
    expect(resumed).not.toContain('id: 1\n');
    controller.abort();
  });

  it('reports lines that do not match the schema as damaged, and never shows them', async () => {
    const { url } = await start(`not json\n${lineOf(1)}\n`);
    const response = await connect(`${url}/api/events`);
    const body = response.body;
    if (body === null) {
      throw new Error('the stream has no body');
    }
    const text = await readUntil(body, (value) => value.includes('event: damaged'));
    expect(text).toContain('event: damaged');
    expect(text).toContain('"count":1');
    expect(text).toContain('id: 1\n');
  });
});
