import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { type ConsoleMode, createConsoleServer } from './app.js';

/**
 * The console's entry point. It listens on the loopback address only, unless the operator names another host. It reads
 * the agent's transition log and never writes to it.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

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

const mode = modeOf(process.env['SIGNOFF_CONSOLE_MODE'] ?? 'live');
const transitionsPath = resolve(
  process.env['SIGNOFF_CONSOLE_TRANSITIONS'] ?? 'apps/agent/state/agent-log.jsonl',
);
const host = process.env['SIGNOFF_CONSOLE_HOST'] ?? '127.0.0.1';
if (!LOOPBACK.has(host)) {
  throw new RangeError('the console listens on the loopback address only');
}
const port = portOf(process.env['SIGNOFF_CONSOLE_PORT'] ?? '4180');
const builtWeb = resolve('apps/console/dist/web');

const server = createConsoleServer({
  transitionsPath,
  mode,
  pollMs: 500,
  staticDir: existsSync(builtWeb) ? builtWeb : null,
});

server.listen(port, host, () => {
  process.stdout.write(`console listening on ${host}:${String(port)} (${mode})\n`);
});
