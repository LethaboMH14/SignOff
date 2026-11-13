/* eslint-disable security/detect-non-literal-fs-filename -- the operator-named paths are inside the local SignOff folder, checked by assertOutsideRepository */
// One command for the RLUSD demo: starts the Warden, the agent and the console as three separate processes, each
// with only its own identity and environment, health-checks each, and fails loudly if a key or a secret is missing.
//
//   npm run demo                     drops one fresh fictional rand invoice (default R16.00) and runs it end to end
//   npm run demo -- --zar 20.00      the same with another amount (sized to the RLUSD the spending account holds)
//   npm run demo -- --provider meta --model <id>  the model provider (groq is the default); the key and address come from .env
//   npm run demo -- --email          also watches SignOff's mailbox; the run's invoice waits in the outbox for you to
//                                    email it (see docs/EMAIL-DEMO.md)
//
// Prerequisites (one time): npm run testnet:provision, then npm run demo:prepare (see docs/RLUSD-TESTNET-RUNBOOK.md).
// The processes run in the foreground. Press Ctrl+C to stop all three.
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { loadDotEnv } from '../../packages/shared/src/node.js';
import { AGENT_POLICY_VERSION } from '../../apps/agent/src/config.js';
import { requireAccount, RLUSD_TESTNET } from '../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileRegistryStore,
} from '../../packages/xrpl/src/node.js';
import { writeDemoInvoice } from './demo-invoice.js';
import { DEMO_LISTEN } from './prepare.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const WARDEN_URL = `http://${DEMO_LISTEN.host}:${String(DEMO_LISTEN.port)}`;
const CONSOLE_PORT = 4180;
const CONSOLE_URL = `http://127.0.0.1:${String(CONSOLE_PORT)}`;

/** Environment names that carry secrets. Each child process receives only the ones it needs. */
const SECRET_NAME = /(_API_KEY|_SECRET|_SEED|_TOKEN|_PASSWORD)$|^SIGNOFF_(AGENT|WARDEN_READER)_/;

class DemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoError';
  }
}

/** A child's environment: the system variables it needs to run, with secrets removed, then its own variables. */
function envFor(own: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !SECRET_NAME.test(entry[0]) && !entry[0].startsWith('SIGNOFF_'),
  );
  return { ...Object.fromEntries(inherited), ...own };
}

/**
 * The provider's variables for the agent process only: its key, and for Meta the https address the key is sent to.
 * Read from the environment or the repository's .env, and never printed.
 */
function providerEnv(provider: 'groq' | 'meta'): Record<string, string> {
  const need = (name: string, value: string | undefined): string => {
    if (value === undefined || value.trim() === '') {
      throw new DemoError(
        `${name} is not set, in the environment or in .env. Nothing was started.`,
      );
    }
    return value.trim();
  };
  if (provider === 'groq') {
    return { GROQ_API_KEY: need('GROQ_API_KEY', process.env['GROQ_API_KEY']) };
  }
  const base = need('META_API_BASE_URL', process.env['META_API_BASE_URL']);
  if (!base.startsWith('https://')) {
    throw new DemoError('META_API_BASE_URL must start with https://. Nothing was started.');
  }
  return {
    META_API_KEY: need('META_API_KEY', process.env['META_API_KEY']),
    META_API_BASE_URL: base,
  };
}

/**
 * The mail watcher's variables, for its process only: the mailbox, its app password and the allowed senders. Read from
 * the environment or the repository's .env, and never printed.
 */
function mailEnv(): Record<string, string> {
  const need = (name: string): string => {
    // eslint-disable-next-line security/detect-object-injection -- the names are the fixed SIGNOFF_MAIL_ settings below
    const value = process.env[name]?.trim() ?? '';
    if (value === '') {
      throw new DemoError(
        `${name} is not set, in the environment or in .env. --email needs it (see docs/EMAIL-DEMO.md). Nothing was started.`,
      );
    }
    return value;
  };
  const optional = (name: string): Record<string, string> => {
    // eslint-disable-next-line security/detect-object-injection -- the names are the fixed SIGNOFF_MAIL_ settings below
    const value = process.env[name]?.trim() ?? '';
    return value === '' ? {} : { [name]: value };
  };
  return {
    SIGNOFF_MAIL_USER: need('SIGNOFF_MAIL_USER'),
    SIGNOFF_MAIL_PASSWORD: need('SIGNOFF_MAIL_PASSWORD'),
    SIGNOFF_MAIL_ALLOWED_SENDERS: need('SIGNOFF_MAIL_ALLOWED_SENDERS'),
    ...optional('SIGNOFF_MAIL_HOST'),
    ...optional('SIGNOFF_MAIL_PORT'),
    ...optional('SIGNOFF_MAIL_AUTHSERV'),
  };
}

interface Child {
  readonly name: string;
  readonly process: ChildProcess;
  readonly lines: string[];
}

const children: Child[] = [];

/** Starts one process, keeps its last output lines for failure reports, and records when it exits. */
function start(name: string, args: string[], env: NodeJS.ProcessEnv): Child {
  // The tsx entry point is started directly, without a shell: a shell joins arguments with spaces unescaped, and the
  // repository path on this machine contains a space.
  const tsxCli = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsxCli, ...args], {
    cwd: repoRoot,
    env,
    windowsHide: true,
  });
  const entry: Child = { name, process: child, lines: [] };
  const keep = (data: Buffer): void => {
    for (const line of data
      .toString('utf8')
      .split('\n')
      .filter((text) => text.trim() !== '')) {
      entry.lines.push(line.slice(0, 300));
      if (entry.lines.length > 60) {
        entry.lines.shift();
      }
      process.stdout.write(`[${name}] ${line}\n`);
    }
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => {
    if (!stopping) {
      process.stderr.write(
        `[${name}] exited unexpectedly (code ${String(code)}); stopping the demo\n`,
      );
      stopAll();
      process.exitCode = 1;
    }
  });
  children.push(entry);
  return entry;
}

let stopping = false;

function stopAll(): void {
  stopping = true;
  for (const child of children) {
    if (child.process.pid !== undefined && !child.process.killed) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.process.pid), '/T', '/F'], { windowsHide: true });
      } else {
        child.process.kill('SIGTERM');
      }
    }
  }
}

async function waitFor(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((done) => {
      setTimeout(done, 1000);
    });
  }
  throw new DemoError(
    `${what} did not become ready within ${String(Math.round(timeoutMs / 1000))} seconds`,
  );
}

async function getJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text.slice(0, 200);
  }
  return { status: response.status, body };
}

/**
 * Moves the invoices of earlier runs out of the inbox. The agent reads every file in the inbox at start-up, so an
 * invoice left there would be processed again. The files are moved, not deleted, so their records stay on disk.
 */
function archiveInbox(localDir: string): void {
  const inbox = join(localDir, 'demo', 'inbox');
  if (!existsSync(inbox)) {
    return;
  }
  const earlier = readdirSync(inbox).filter((name) => name.endsWith('.pdf'));
  if (earlier.length === 0) {
    return;
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const archive = join(localDir, 'demo', `inbox-archive-${stamp}`);
  mkdirSync(archive, { recursive: true });
  for (const name of earlier) {
    renameSync(join(inbox, name), join(archive, name));
  }
  process.stdout.write(
    `[demo] moved ${String(earlier.length)} earlier invoice(s) out of the inbox to ${archive}\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const zarIndex = args.indexOf('--zar');
  const providerIndex = args.indexOf('--provider');
  const zarText = zarIndex >= 0 ? (args[zarIndex + 1] ?? '') : '16.00';
  if (!/^\d+\.\d{2}$/.test(zarText)) {
    throw new DemoError('--zar must be a rand amount such as 16.00');
  }
  const zarMinor = Number(zarText.replace('.', ''));
  const providerText = providerIndex >= 0 ? (args[providerIndex + 1] ?? 'groq') : 'groq';
  if (providerText !== 'groq' && providerText !== 'meta') {
    throw new DemoError('--provider must be groq or meta');
  }
  const provider: 'groq' | 'meta' = providerText;
  const modelIndex = args.indexOf('--model');
  const model = modelIndex >= 0 ? (args[modelIndex + 1] ?? '') : '';
  if (modelIndex >= 0 && !/^[A-Za-z0-9._:/-]{1,80}$/.test(model)) {
    throw new DemoError('--model must be a model id such as muse-spark-1.1');
  }

  const localDir = defaultLocalDir();
  assertOutsideRepository(localDir, repoRoot);
  loadDotEnv(resolve(repoRoot, '.env'));
  const providerVars = providerEnv(provider);
  const email = args.includes('--email');
  const mailVars = email ? mailEnv() : null;

  const registry = await fileRegistryStore(join(localDir, 'registry.json')).read();
  if (registry === null) {
    throw new DemoError('no registry; run npm run testnet:provision first. Nothing was started.');
  }

  const agent = requireAccount(registry, 'agent');
  const wardenAccount = requireAccount(registry, 'warden');
  if (agent.seed === undefined || wardenAccount.seed === undefined) {
    throw new DemoError(
      'the agent or Warden seed is missing from the registry. Nothing was started.',
    );
  }
  const identityPath = join(localDir, 'demo', 'identities.json');
  if (!existsSync(join(localDir, 'warden', 'warden-keys.json')) || !existsSync(identityPath)) {
    throw new DemoError(
      'the demo is not prepared; run npm run demo:prepare first. Nothing was started.',
    );
  }
  const identities = z
    .strictObject({
      schemaVersion: z.literal(1),
      agentId: z.string(),
      agentSecretHex: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .parse(JSON.parse(readFileSync(identityPath, 'utf8')) as unknown);
  const callersPath = join(localDir, 'warden', 'warden-callers.json');
  const callers = z
    .object({ principals: z.array(z.object({ id: z.string(), secret: z.string() })) })
    .parse(JSON.parse(readFileSync(callersPath, 'utf8')) as unknown);
  const operatorSecret = callers.principals.find((entry) => entry.id === 'operator-a')?.secret;
  if (operatorSecret === undefined) {
    throw new DemoError(
      'the operator secret is missing from the Warden folder. Nothing was started.',
    );
  }
  // The console reads the Warden's operator views with operator-a's secret; the file is read by the console only.
  const readerSecretPath = join(localDir, 'demo', 'operator-a.secret');
  writeFileSync(readerSecretPath, `${operatorSecret}\n`, { mode: 0o600 });

  // A process that is already listening means a demo is running: refuse rather than start a second copy.
  const alreadyUp = await getJson(`${WARDEN_URL}/v1/health`).then(
    () => true,
    () => false,
  );
  if (alreadyUp) {
    throw new DemoError(
      `a Warden already answers at ${WARDEN_URL}. Stop it first. Nothing was started.`,
    );
  }
  // A lock left by a process that was killed is removed only here, when no Warden or console answers, so no run is live.
  const demoDir = join(localDir, 'demo');
  for (const lock of [join(localDir, 'warden', 'run.lock'), join(demoDir, 'run.lock')]) {
    if (existsSync(lock)) {
      rmSync(lock, { recursive: true, force: true });
      process.stdout.write(`[demo] removed a stale lock left by an earlier run: ${lock}\n`);
    }
  }

  // The run's invoice and its evidence are written before the Warden starts. The Warden reads its evidence file only at
  // start-up, so a record written after it started would be missing, and the new invoice would be held.
  archiveInbox(localDir);
  // With --email the run's invoice goes to the outbox, for a person to email to SignOff's mailbox.
  const invoice = await writeDemoInvoice(zarMinor, localDir, {
    delivery: email ? 'outbox' : 'inbox',
  });
  process.stdout.write(
    `[demo] invoice ${invoice.file} R${(zarMinor / 100).toFixed(2)} = USD ${(invoice.usdMinor / 100).toFixed(2)} at USD/ZAR ${invoice.rate} (live)\n`,
  );
  if (mailVars !== null) {
    process.stdout.write(
      `[demo] email mode: attach ${invoice.path} to an email from an allowed sender to ${String(mailVars['SIGNOFF_MAIL_USER'])}\n`,
    );
  }

  // 1. Warden: its own directory, its own keys, no agent or console variables.
  start('warden', [join('apps', 'warden', 'src', 'main.ts')], envFor({}));
  await waitFor(
    async () => {
      const health = await getJson(`${WARDEN_URL}/v1/health`).catch(() => null);
      return (
        health !== null &&
        health.status === 200 &&
        (health.body as { ready?: boolean }).ready === true
      );
    },
    'the Warden',
    60_000,
  );

  // 2. The agent, with only its identity and its provider key.
  const wardenHealth = (await getJson(`${WARDEN_URL}/v1/health`)).body as {
    policyVersion?: string;
  };
  if (wardenHealth.policyVersion !== AGENT_POLICY_VERSION) {
    throw new DemoError(
      `the Warden's policy version (${String(wardenHealth.policyVersion)}) is not the agent's (${AGENT_POLICY_VERSION}). Nothing was started.`,
    );
  }
  const agentLog = join(demoDir, 'agent-log.jsonl');
  const agentChild = start(
    'agent',
    [
      join('apps', 'agent', 'src', 'main.ts'),
      'run',
      '--inbox',
      join(demoDir, 'inbox'),
      '--log',
      agentLog,
      '--evidence',
      join(demoDir, 'evidence-agent.json'),
      '--suppliers',
      join(demoDir, 'suppliers.json'),
      '--warden-url',
      WARDEN_URL,
      '--provider',
      provider,
      ...(model === '' ? [] : ['--model', model]),
      '--interval-ms',
      '1000',
    ],
    envFor({
      SIGNOFF_AGENT_ID: identities.agentId,
      SIGNOFF_AGENT_SECRET: identities.agentSecretHex,
      SIGNOFF_AGENT_SEED: agent.seed,
      ...providerVars,
    }),
  );
  await waitFor(
    () => Promise.resolve(agentChild.lines.some((line) => line.includes('agent running'))),
    'the agent',
    60_000,
  );

  // 3. The console: read-only views of the Warden and the agent log, with a read-only Warden principal.
  start(
    'console',
    [join('apps', 'console', 'src', 'server', 'main.ts')],
    envFor({
      SIGNOFF_WARDEN_URL: WARDEN_URL,
      SIGNOFF_CONSOLE_MODE: 'live',
      SIGNOFF_CONSOLE_TRANSITIONS: agentLog,
      SIGNOFF_TOKEN_ISSUER: RLUSD_TESTNET.issuer,
      SIGNOFF_RLUSD_ISSUER: RLUSD_TESTNET.issuer,
      SIGNOFF_WARDEN_READER_ID: 'operator-a',
      SIGNOFF_WARDEN_READER_SECRET_FILE: readerSecretPath,
      SIGNOFF_CONSOLE_PORT: String(CONSOLE_PORT),
      SIGNOFF_DEMO_DIR: localDir,
      ...(mailVars === null ? {} : { SIGNOFF_DEMO_MAIL_TO: mailVars['SIGNOFF_MAIL_USER'] ?? '' }),
    }),
  );
  await waitFor(
    async () => {
      const health = await getJson(`${CONSOLE_URL}/api/health`).catch(() => null);
      return health !== null && health.status === 200;
    },
    'the console',
    60_000,
  );

  // 3b. The mail watcher, with --email: the mailbox password and nothing else. It copies accepted PDFs into the inbox.
  if (mailVars !== null) {
    const mailChild = start(
      'mail',
      [
        join('apps', 'agent', 'src', 'mail', 'main.ts'),
        '--inbox',
        join(demoDir, 'inbox'),
        '--log',
        join(demoDir, 'mail-log.jsonl'),
      ],
      envFor(mailVars),
    );
    await waitFor(
      () => Promise.resolve(mailChild.lines.some((line) => line.includes('mail watcher running'))),
      'the mail watcher (check SIGNOFF_MAIL_USER and the app password)',
      60_000,
    );
  }

  // 4. Wait for the run's decision. It is read from the agent's own transition log, not from its stdout, because
  // a stdout line can be missed. A decision is the last move of this invoice in a terminal state.
  const terminal = new Set([
    'HELD',
    'QUARANTINED',
    'RECONCILED',
    'FAILED',
    'RECONCILIATION_EXCEPTION',
  ]);
  // An emailed invoice waits for a person to send it, so that run waits longer.
  const deadline = Date.now() + (email ? 20 : 5) * 60_000;
  let finalLine: string | null = null;
  while (Date.now() < deadline && finalLine === null) {
    const moves = existsSync(agentLog)
      ? readFileSync(agentLog, 'utf8')
          .split(String.fromCharCode(10))
          .filter((text) => text.trim() !== '')
      : [];
    const mine = moves
      .map((text) =>
        z
          .object({ correlationId: z.string(), toState: z.string(), reasonCode: z.string() })
          .parse(JSON.parse(text) as unknown),
      )
      .filter((move) => move.correlationId === invoice.fingerprint);
    const last = mine.at(-1);
    if (last !== undefined && terminal.has(last.toState)) {
      finalLine = `${last.toState} ${last.reasonCode}`;
    } else {
      await new Promise((done) => {
        setTimeout(done, 2000);
      });
    }
  }
  process.stdout.write(
    `[demo] agent decision for ${invoice.file}: ${finalLine ?? 'no decision within 5 minutes'}
`,
  );
  process.stdout.write(
    `[demo] console: ${CONSOLE_URL} (sign in as the demo operator; its password is in ${join(demoDir, 'console-password.txt')})\n`,
  );
  process.stdout.write('[demo] all processes are running. Press Ctrl+C to stop them.\n');
}

process.on('SIGINT', () => {
  stopAll();
  process.exitCode = 0;
});
process.on('SIGTERM', () => {
  stopAll();
});

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  stopAll();
  process.exitCode = 1;
});
