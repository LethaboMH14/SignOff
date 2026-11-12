#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- every path here is built from fixed names in this file and the operator-set SIGNOFF_LOCAL_DIR; no request input reaches the filesystem. */
// Container start-up guard for one service: `node deploy/entrypoint.mjs warden` or `... console`.
// Each secret comes from the host's secret store as an environment variable, is written into the service's private
// directory (mode 0600), and only then is the service started. A missing secret stops the container before the service
// runs. The error names the variable, never its value. Nothing here is printed or logged.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = {
  warden: {
    command: ['npm', 'run', 'warden:serve'],
    files: [
      // The Warden's configuration and keys: only the Warden container has these variables.
      { env: 'SIGNOFF_WARDEN_CONFIG_B64', file: 'warden-config.json', decode: true },
      { env: 'SIGNOFF_WARDEN_KEYS_B64', file: 'warden-keys.json', decode: true },
    ],
  },
  console: {
    command: ['npm', 'run', 'console:serve'],
    files: [
      // The operator file (password hashes and each operator's Warden secret), and the console's read-only reader secret.
      { env: 'SIGNOFF_CONSOLE_OPERATORS_B64', file: 'operators.json', decode: true },
      { env: 'SIGNOFF_WARDEN_READER_SECRET_B64', file: 'reader.secret', decode: false },
    ],
  },
};

const service = process.argv[2];
const spec = SERVICES[service];
if (spec === undefined) {
  process.stderr.write('startup refused: name the service as warden or console\n');
  process.exit(2);
}

const localDir = process.env['SIGNOFF_LOCAL_DIR'];
if (localDir === undefined || localDir === '') {
  process.stderr.write('startup refused: SIGNOFF_LOCAL_DIR must name the persistent directory\n');
  process.exit(2);
}

const missing = spec.files.filter((entry) => {
  const value = process.env[entry.env];
  return value === undefined || value.trim() === '';
});
if (missing.length > 0) {
  process.stderr.write(
    `startup refused: missing secret ${missing.map((entry) => entry.env).join(', ')}\n`,
  );
  process.exit(1);
}

const directory = join(localDir, service);
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const entry of spec.files) {
  const value = process.env[entry.env] ?? '';
  const bytes = entry.decode
    ? Buffer.from(value.trim(), 'base64')
    : Buffer.from(value.trim(), 'utf8');
  if (bytes.length === 0) {
    process.stderr.write(`startup refused: ${entry.env} is not valid base64 text\n`);
    process.exit(1);
  }
  const target = join(directory, entry.file);
  writeFileSync(target, bytes, { mode: 0o600 });
  chmodSync(target, 0o600);
}

const [program, ...args] = spec.command;
const child = spawn(program, args, { stdio: 'inherit', shell: process.platform === 'win32' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
