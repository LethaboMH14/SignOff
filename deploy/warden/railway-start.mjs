/* eslint-disable security/detect-non-literal-fs-filename -- the paths are the Warden folder on the container volume, fixed by SIGNOFF_LOCAL_DIR */
// The Warden's start script on Railway (docs/HOSTED-WARDEN.md). It runs before the Warden, in the same container.
//
// 1. On the first start only, it writes the Warden's folder onto the persistent volume from one variable,
//    SIGNOFF_WARDEN_BUNDLE (gzip, then base64, of a JSON map of file name to content), which the operator pastes into
//    Railway. The bundle is built on the operator's machine by `npm run demo:hosted-bundle` and holds the Warden's keys,
//    configuration, callers, evidence and its event log and journal. Files already on the volume are never overwritten.
// 2. It removes a run.lock left by a container that was stopped without a clean exit. Railway runs one replica of
//    this service with a volume attached, so no other Warden can hold the lock.
// 3. It starts the Warden with the bundle variable removed from the Warden's environment.
//
// It prints file names and counts only, never a file's content.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ALLOWED = new Set([
  'warden-config.json',
  'warden-keys.json',
  'warden-callers.json',
  'evidence.json',
  'events.jsonl',
  'payments-journal.jsonl',
]);

const localDir = process.env.SIGNOFF_LOCAL_DIR ?? '/data';
const directory = join(localDir, 'warden');
mkdirSync(directory, { recursive: true });

const bundle = process.env.SIGNOFF_WARDEN_BUNDLE ?? '';
if (!existsSync(join(directory, 'warden-keys.json'))) {
  if (bundle.trim() === '') {
    process.stderr.write(
      'railway-start: no Warden folder on the volume and SIGNOFF_WARDEN_BUNDLE is not set\n',
    );
    process.exit(1);
  }
  let files;
  try {
    files = JSON.parse(gunzipSync(Buffer.from(bundle.trim(), 'base64')).toString('utf8'));
  } catch {
    // A parse error message can quote the text it failed on, which here holds the Warden key. Print fixed text only.
    process.stderr.write(
      'railway-start: SIGNOFF_WARDEN_BUNDLE could not be read; paste it again\n',
    );
    process.exit(1);
  }
  const entries = Object.entries(files);
  for (const [name, content] of entries) {
    if (!ALLOWED.has(name) || typeof content !== 'string') {
      process.stderr.write(`railway-start: refused an unexpected bundle entry\n`);
      process.exit(1);
    }
  }
  // The keys file marks a seeded volume, so it is written last: a start that dies part-way leaves no keys file, and
  // the next start seeds again.
  entries.sort(([a], [b]) => Number(a === 'warden-keys.json') - Number(b === 'warden-keys.json'));
  let written = 0;
  for (const [name, content] of entries) {
    const path = join(directory, name);
    writeFileSync(path, content, { mode: 0o600 });
    chmodSync(path, 0o600);
    written += 1;
  }
  process.stdout.write(
    `railway-start: wrote ${String(written)} Warden files to the volume (first start)\n`,
  );
} else {
  process.stdout.write(
    'railway-start: the Warden folder is already on the volume; the bundle is not used\n',
  );
}

const lock = join(directory, 'run.lock');
if (existsSync(lock)) {
  rmSync(lock, { recursive: true, force: true });
  process.stdout.write('railway-start: removed a run.lock left by an earlier container\n');
}

const env = { ...process.env };
delete env.SIGNOFF_WARDEN_BUNDLE;
const child = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'apps/warden/src/main.ts'],
  {
    env,
    stdio: 'inherit',
  },
);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
