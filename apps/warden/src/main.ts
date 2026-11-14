import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Wallet } from 'xrpl';

import {
  connectTestnetPort,
  testnetEndpoints,
  type LedgerPort,
} from '../../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileJournalStore,
  withLock,
} from '../../../packages/xrpl/src/node.js';

import { RequestVerifier } from './auth.js';
import { loadConfig, loadKeys, type WardenConfig } from './config.js';
import { xamanApprover, type OwnerApprover } from './owner-approval.js';
import { fileEventLog } from './events.js';
import { watchedEvidenceRegister } from '../../../packages/shared/src/watched-evidence.js';
import { simulatedIdentityChecker } from './identity.js';
import { createWardenServer } from './server.js';
import { WardenService } from './service.js';

/**
 * The Warden's entry point. It runs as its own process, reads only its own keys file and configuration, and
 * writes only to its own directory. Start it with `npm run warden:serve` from the repository root.
 */

async function connectFirstAvailable(): Promise<LedgerPort> {
  for (const endpoint of testnetEndpoints()) {
    try {
      return await connectTestnetPort(endpoint);
    } catch {
      process.stderr.write('warden: a testnet endpoint did not answer; trying the next\n');
    }
  }
  throw new Error('no testnet endpoint answered');
}

/**
 * The owner approver, when the configuration has a high-value route and the Xaman variables are set. Without
 * them, high-value payments are held (OWNER_APPROVAL_UNAVAILABLE). The variables are never printed.
 */
function ownerApproverFor(config: WardenConfig): OwnerApprover | undefined {
  if (config.highValue === null) {
    return undefined;
  }
  const apiKey = process.env['XAMAN_API_KEY']?.trim() ?? '';
  const apiSecret = process.env['XAMAN_API_SECRET']?.trim() ?? '';
  if (apiKey === '' || apiSecret === '') {
    process.stderr.write(
      'warden: high-value route configured but no Xaman keys; high-value payments will be held\n',
    );
    return undefined;
  }
  const userToken = process.env['XAMAN_USER_TOKEN']?.trim() ?? '';
  return xamanApprover({
    apiKey,
    apiSecret,
    ownerAddress: config.highValue.ownerAddress,
    userToken: userToken === '' ? null : userToken,
    expireMinutes: 4,
    pollMs: 3000,
    onCreated: ({ link, pushed }) => {
      process.stdout.write(
        `warden: owner approval requested (${pushed ? 'pushed to the phone' : 'open this link on the phone'}): ${link}\n`,
      );
    },
  });
}

async function serve(directory: string): Promise<void> {
  const config = loadConfig(join(directory, 'warden-config.json'));
  const keys = loadKeys(join(directory, 'warden-keys.json'));
  const wardenWallet = Wallet.fromSeed(keys.wardenSeed);
  if (wardenWallet.address !== config.wardenAddress) {
    throw new Error('the Warden key does not match the configured Warden account');
  }
  const port = await connectFirstAvailable();
  const ownerApprover = ownerApproverFor(config);
  const service = await WardenService.open({
    ...(ownerApprover === undefined ? {} : { ownerApprover }),
    config,
    wardenWallet,
    log: fileEventLog(join(directory, 'events.jsonl')),
    journal: fileJournalStore(join(directory, 'payments-journal.jsonl')),
    port,
    evidence: watchedEvidenceRegister(join(directory, 'evidence.json')),
    identity: simulatedIdentityChecker(new Set(config.verifiedPayees)),
    now: () => new Date(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    newId: () => randomUUID(),
  });
  await service.recover();
  const verifier = new RequestVerifier(keys.principals, () => new Date(), Date.now());
  const server = createWardenServer(service, verifier, () => {
    process.stderr.write('warden: internal error\n');
  });
  await new Promise<void>((listening, failed) => {
    server.once('error', failed);
    server.listen(config.listen.port, config.listen.host, () => {
      server.off('error', failed);
      listening();
    });
  });
  process.stdout.write(`warden listening on ${config.listen.host}:${String(config.listen.port)}\n`);
  await new Promise<void>(() => {
    // Runs until the process is stopped. The directory lock is released only by a clean exit.
  });
}

/** A start-up refusal whose message is fixed text written by this file, so it is safe to print. */
class StartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartError';
  }
}

/**
 * The cause of a start-up failure. A file's value can appear in an error message, so only fixed text from this
 * file and system error codes are printed; any other failure is named by its class.
 */
function causeOf(error: unknown): string {
  if (error instanceof StartError) {
    return error.message;
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const directory = join(defaultLocalDir(), 'warden');
  assertOutsideRepository(directory, repoRoot);
  // The directory is the Warden's private local directory, checked by assertOutsideRepository above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (existsSync(join(directory, 'run.lock'))) {
    throw new StartError(
      'a run.lock file is present; confirm that no Warden is running, then remove that file',
    );
  }
  await withLock(directory, () => serve(directory));
}

main().catch((error: unknown) => {
  process.stderr.write(`warden: could not start (${causeOf(error)})\n`);
  process.exitCode = 1;
});
