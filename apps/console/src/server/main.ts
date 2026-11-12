import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WardenClient } from '../../../../packages/warden-api/src/client.js';
import {
  connectTestnetPort,
  type LedgerPort,
  testnetEndpoints,
} from '../../../../packages/xrpl/src/index.js';
import { assertOutsideRepository, defaultLocalDir } from '../../../../packages/xrpl/src/node.js';

import { type ApiContext, type WardenPort } from './api.js';
import { type ConsoleMode, createConsoleServer } from './app.js';
import { type Operator, loadOperators } from './auth/operators.js';
import { LoginGuard, SessionStore } from './auth/sessions.js';
import { type ReceiptLedger, TESTNET_EXPLORER } from './receipt.js';

/**
 * The console's entry point. It listens on the loopback address only, unless the operator names another host. It reads
 * the agent's transition log and never writes to it. Each signed-in person calls the Warden with their own principal;
 * the operator file and the secrets it names live outside the repository.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');

function modeOf(text: string): ConsoleMode {
  if (text === 'simulated' || text === 'live') {
    return text;
  }
  throw new RangeError('SIGNOFF_CONSOLE_MODE must be simulated or live');
}

function portOf(text: string): number {
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('SIGNOFF_CONSOLE_PORT must be a port number');
  }
  return port;
}

function secretOf(path: string): Buffer {
  // The secret file is the operator's own, outside the repository; it is read once at start-up and never printed.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own secret file, read once at start-up
  return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
}

const mode = modeOf(process.env['SIGNOFF_CONSOLE_MODE'] ?? 'live');
const transitionsPath = resolve(
  process.env['SIGNOFF_CONSOLE_TRANSITIONS'] ?? 'apps/agent/state/agent-log.jsonl',
);
const host = process.env['SIGNOFF_CONSOLE_HOST'] ?? '127.0.0.1';
if (!LOOPBACK.has(host)) {
  throw new RangeError('the console listens on the loopback address only');
}
const port = portOf(process.env['SIGNOFF_CONSOLE_PORT'] ?? '4180');
const wardenUrl = process.env['SIGNOFF_WARDEN_URL'];
if (wardenUrl === undefined || !/^https?:\/\//.test(wardenUrl)) {
  throw new RangeError(
    'SIGNOFF_WARDEN_URL must name the Warden, for example http://127.0.0.1:8080',
  );
}
const operatorsPath = resolve(
  process.env['SIGNOFF_CONSOLE_OPERATORS'] ?? join(defaultLocalDir(), 'console', 'operators.json'),
);
assertOutsideRepository(dirname(operatorsPath), repoRoot);

/* The Warden's address, narrowed once above and kept as a plain string for the closures below. */
const wardenBaseUrl: string = wardenUrl;

const readerId = process.env['SIGNOFF_WARDEN_READER_ID'];
const readerSecretFile = process.env['SIGNOFF_WARDEN_READER_SECRET_FILE'];
// The reader's secret file is the operator's own, named at start-up; its presence is checked once.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own secret file, named at start-up
const readerSecretPresent = readerSecretFile !== undefined && existsSync(readerSecretFile);
const reader: WardenPort | null =
  readerId !== undefined && readerSecretFile !== undefined && readerSecretPresent
    ? new WardenClient({
        baseUrl: wardenBaseUrl,
        principalId: readerId,
        secret: secretOf(readerSecretFile),
      })
    : null;

const builtWeb = resolve('apps/console/dist/web');
const version = (
  JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as {
    readonly version: string;
  }
).version;

function wardenFor(operator: Operator): WardenPort | null {
  if (operator.role === 'viewer') {
    return reader;
  }
  if (operator.wardenPrincipal === null || operator.wardenSecret === null) {
    return null;
  }
  return new WardenClient({
    baseUrl: wardenBaseUrl,
    principalId: operator.wardenPrincipal,
    secret: operator.wardenSecret,
  });
}

/** The first testnet endpoint that answers. The receipt asks the ledger only when a receipt is opened. */
async function connectFirstAvailable(): Promise<LedgerPort> {
  for (const endpoint of testnetEndpoints()) {
    try {
      return await connectTestnetPort(endpoint);
    } catch {
      process.stderr.write('console: a testnet endpoint did not answer; trying the next\n');
    }
  }
  throw new Error('no testnet endpoint answered');
}

/**
 * The ledger for receipts. It connects on first use, and connects again after a failure, so a ledger that is down at
 * start-up does not stop the console.
 */
function lazyLedgerOf(): ReceiptLedger {
  let port: Promise<LedgerPort> | null = null;
  return {
    lookup: async (hash) => {
      port ??= connectFirstAvailable();
      try {
        return await (await port).lookup(hash);
      } catch (error) {
        port = null;
        throw error;
      }
    },
  };
}

const api: ApiContext = {
  operators: loadOperators(operatorsPath),
  sessions: new SessionStore(() => Date.now()),
  guard: new LoginGuard(() => Date.now()),
  transitionsPath,
  allowedOrigins: new Set([`http://127.0.0.1:${String(port)}`, `http://localhost:${String(port)}`]),
  version,
  mode,
  wardenFor,
  now: () => new Date(),
  ledger: lazyLedgerOf(),
  receipts: {
    tokenIssuer: process.env['SIGNOFF_TOKEN_ISSUER'] ?? null,
    rlusdIssuer: process.env['SIGNOFF_RLUSD_ISSUER'] ?? null,
    explorerBase: process.env['SIGNOFF_EXPLORER_BASE'] ?? TESTNET_EXPLORER,
    demoRandPerUnit: process.env['SIGNOFF_DEMO_RAND_PER_UNIT'] ?? null,
  },
};

const server = createConsoleServer({
  transitionsPath,
  mode,
  pollMs: 500,
  staticDir: existsSync(builtWeb) ? builtWeb : null,
  api,
});

server.listen(port, host, () => {
  process.stdout.write(`console listening on ${host}:${String(port)} (${mode})\n`);
});
