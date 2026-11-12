// Gate A command line. Testnet only: every endpoint is checked against the allow-list before a socket
// opens, and the local registry, journal and lock live outside the repository. Output contains roles,
// result codes, counts and transaction hashes only; no addresses and no seeds.
// Usage: npm run testnet:<provision|signers|pay|pay-rlusd|rejections|timeout|failover|rebuild>
// The rebuild abandons the current spending account and refunds it, so it runs only with --confirm.
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'xrpl';
import {
  compareDecimal,
  configureSigners,
  connectTestnetPort,
  deliveredBalance,
  demonstrateRejections,
  failoverDrill,
  provisionTestnet,
  rebuildFromReserve,
  requireAccount,
  rlusdAmount,
  RLUSD_TESTNET,
  sendTwoSignatureTransfer,
  testnetEndpoints,
  testTokenAmount,
  timeoutDrill,
  type LedgerPort,
  type LogFn,
  type PaymentDeps,
  type ProvisionDeps,
  type Transfer,
} from '../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileJournalStore,
  fileRegistryStore,
  withLock,
} from '../../packages/xrpl/src/node.js';
import { createLogger } from '../../packages/shared/src/logging/index.js';

type Deps = ProvisionDeps & PaymentDeps;
type Runner = (deps: Deps, primary: LedgerPort) => Promise<unknown>;
type Logger = ReturnType<typeof createLogger>;

/** Narrows a lookup result, failing with a clear message when it is missing. */
function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** A test-token transfer from the spending account to the supplier, for a given amount. */
async function tokenTransfer(deps: Deps, paymentId: string, value: string): Promise<Transfer> {
  const registry = must(await deps.registry.read(), 'no registry; run the provision step first');
  return {
    paymentId,
    from: requireAccount(registry, 'spending'),
    to: requireAccount(registry, 'supplier'),
    amount: testTokenAmount(requireAccount(registry, 'issuer'), value),
  };
}

/**
 * A testnet RLUSD transfer from the spending account to the supplier. Before anything is sent, it checks
 * that the spending account holds the amount and that the supplier has an RLUSD trust line, so a missing
 * balance is refused here rather than by the ledger.
 */
async function rlusdTransfer(deps: Deps, paymentId: string, value: string): Promise<Transfer> {
  const registry = must(await deps.registry.read(), 'no registry; run the provision step first');
  const from = requireAccount(registry, 'spending');
  const to = requireAccount(registry, 'supplier');
  const amount = rlusdAmount(value);
  const held = await deliveredBalance(deps.port, from, amount);
  if (compareDecimal(held, value) < 0) {
    throw new Error(
      `the spending account holds ${held} testnet RLUSD and this payment needs ${value}; fund it first (TEST-LOG T-059). Nothing was sent.`,
    );
  }
  const line = await deps.port.trustLine(to.address, {
    currency: RLUSD_TESTNET.currency,
    issuer: RLUSD_TESTNET.issuer,
  });
  if (!line) {
    throw new Error('the supplier has no testnet RLUSD trust line. Nothing was sent.');
  }
  return { paymentId, from, to, amount };
}

/**
 * A proof's payment id. A payment id that is already in the journal is never sent again, so a new run names a new id
 * with SIGNOFF_PROOF_RUN (lower-case letters, digits and hyphens). Without it the id is the one the earlier runs used.
 */
function proofId(base: string): string {
  const run = process.env['SIGNOFF_PROOF_RUN'];
  if (run === undefined || run === '') {
    return base;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(run)) {
    throw new RangeError('SIGNOFF_PROOF_RUN must be lower-case letters, digits and hyphens');
  }
  return `${base}.${run}`;
}

const RUNNERS: ReadonlyMap<string, Runner> = new Map<string, Runner>([
  ['provision', (deps) => provisionTestnet(deps)],
  ['signers', (deps) => configureSigners(deps)],
  [
    'pay',
    async (deps) =>
      sendTwoSignatureTransfer(deps, await tokenTransfer(deps, proofId('pay.proof'), '10')),
  ],
  [
    'pay-rlusd',
    async (deps) =>
      sendTwoSignatureTransfer(deps, await rlusdTransfer(deps, proofId('pay-rlusd.proof'), '10')),
  ],
  [
    'rejections',
    async (deps) =>
      demonstrateRejections(deps, await tokenTransfer(deps, proofId('rejections.proof'), '10')),
  ],
  ['timeout', async (deps) => timeoutDrill(deps, await tokenTransfer(deps, 'timeout.proof', '4'))],
  [
    'failover',
    async (deps, primary) => {
      const transfer = await tokenTransfer(deps, 'failover.proof', '3');
      const [, secondaryEndpoint] = testnetEndpoints();
      if (secondaryEndpoint === undefined) {
        throw new Error('no secondary endpoint is configured');
      }
      const secondary = await connectTestnetPort(secondaryEndpoint);
      try {
        return await failoverDrill({ ...deps, port: primary }, transfer, secondary);
      } finally {
        await secondary.disconnect();
      }
    },
  ],
  [
    'rebuild',
    async (deps) => {
      const transfer = await tokenTransfer(deps, 'rebuild.proof', '5');
      return rebuildFromReserve(deps, {
        fundingDrops: '20000000',
        paymentAmount: transfer.amount,
        refundMarginDrops: '100000',
      });
    },
  ],
]);

/** Waits for the given time. Used between ledger polls. */
function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/** A short, non-secret description of why an endpoint did not answer. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown';
  }
  return `${error.name}: ${error.message.slice(0, 120)}`;
}

/**
 * Connects to the first testnet endpoint that answers, in configured order. Each endpoint that does not
 * answer is logged with its reason, so a failover is visible in the run's record rather than silent.
 */
async function connectLogged(logger: Logger): Promise<LedgerPort> {
  for (const endpoint of testnetEndpoints()) {
    try {
      return await connectTestnetPort(endpoint);
    } catch (error) {
      logger.warn('testnet.endpoint.unavailable', { endpoint, reason: describeFailure(error) });
    }
  }
  throw new Error('no testnet endpoint answered');
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  const runner = RUNNERS.get(command);
  if (runner === undefined) {
    process.stderr.write(`usage: gate-a <${[...RUNNERS.keys()].join('|')}>\n`);
    process.exitCode = 2;
    return;
  }
  if (command === 'rebuild' && !process.argv.includes('--confirm')) {
    process.stderr.write(
      'rebuild abandons the current spending account and refunds its balances; run it again with --confirm to proceed\n',
    );
    process.exitCode = 2;
    return;
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir = defaultLocalDir();
  assertOutsideRepository(dir, repoRoot);
  const logger = createLogger({ service: 'signoff-testnet' });
  const log: LogFn = (event, fields) => {
    logger.info(event, fields);
  };
  await withLock(dir, async () => {
    const port = await connectLogged(logger);
    try {
      const deps: Deps = {
        port,
        journal: fileJournalStore(join(dir, 'journal.jsonl')),
        registry: fileRegistryStore(join(dir, 'registry.json')),
        now: () => new Date(),
        sleep,
        pollMs: 2000,
        maxPolls: 120,
        newId: () => randomUUID(),
        newWallet: () => Wallet.generate(),
        log,
        maxAttempts: 3,
      };
      const result = await runner(deps, port);
      process.stdout.write(
        `${JSON.stringify({ command, endpoint: port.endpoint, result }, null, 2)}\n`,
      );
    } finally {
      await port.disconnect();
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
