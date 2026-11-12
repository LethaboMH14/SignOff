import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import { type ApiContext } from './api.js';
import { createConsoleServer } from './app.js';
import { loadOperators } from './auth/operators.js';
import { LoginGuard, SignedSessionStore } from './auth/sessions.js';
import { TESTNET_EXPLORER } from './receipt.js';

/*
 * The simulated console for a serverless host (Vercel). It replays the fixture log that is bundled beside this function,
 * never calls the Warden or the ledger, and keeps no state between requests: sessions are signed cookies. The operator
 * accounts come from SIGNOFF_OPERATORS_B64, a base64 copy of an operator file. For the public demo that file holds
 * viewer accounts only, so nobody can sign in to change anything.
 *
 * Environment: SIGNOFF_SESSION_SECRET (base64, at least 32 bytes), SIGNOFF_OPERATORS_B64, and SIGNOFF_ALLOWED_ORIGINS
 * (the page's own origin, comma separated, so sign-in from any other site is refused).
 */

const BUNDLED_LOG = fileURLToPath(new URL('./simulated-transitions.jsonl', import.meta.url));

function requiredEnv(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function operatorsPath(): string {
  const path = join(tmpdir(), 'signoff-operators.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is fixed: a constant file name in the temporary folder
  writeFileSync(
    path,
    Buffer.from(
      requiredEnv('SIGNOFF_OPERATORS_B64', process.env['SIGNOFF_OPERATORS_B64']),
      'base64',
    ),
  );
  return path;
}

function originsOf(): Set<string> {
  return new Set(
    (process.env['SIGNOFF_ALLOWED_ORIGINS'] ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

const transitionsPath = process.env['SIGNOFF_CONSOLE_TRANSITIONS'] ?? BUNDLED_LOG;

const api: ApiContext = {
  operators: loadOperators(operatorsPath()),
  sessions: new SignedSessionStore(
    () => Date.now(),
    Buffer.from(
      requiredEnv('SIGNOFF_SESSION_SECRET', process.env['SIGNOFF_SESSION_SECRET']),
      'base64',
    ),
  ),
  guard: new LoginGuard(() => Date.now()),
  transitionsPath,
  allowedOrigins: originsOf(),
  version: '0.1.0',
  mode: 'simulated',
  wardenFor: () => null,
  now: () => new Date(),
  ledger: null,
  receipts: {
    tokenIssuer: null,
    rlusdIssuer: null,
    explorerBase: TESTNET_EXPLORER,
    demoRandPerUnit: null,
  },
};

const server = createConsoleServer({
  transitionsPath,
  mode: 'simulated',
  pollMs: 500,
  staticDir: null,
  api,
});

/**
 * The function's entry point. Vercel's route passes the original path as the query parameter `path`; it is put back
 * here, so the same routes answer whether or not the host rewrote the URL.
 */
export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'https://localhost');
  const path = url.searchParams.get('path');
  if (path !== null) {
    url.searchParams.delete('path');
    request.url = `/api/${path}${url.search}`;
  }
  server.emit('request', request, response);
}
