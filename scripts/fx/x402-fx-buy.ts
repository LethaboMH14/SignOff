// The agent buys one USD/ZAR rate from the paid merchant. A dry run by default: it reads the registry, checks the
// agent's wallet and prints what would be paid. With --confirm it sends the x402 payment from the agent's own
// account (about 0.01 XRP on Testnet) and prints the rate it received.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Wallet } from 'xrpl';

import { fetchPaidRate } from '../../apps/agent/src/fx/x402-rate.js';
import { RATE_PATH } from '../../apps/agent/src/fx/x402-merchant.js';
import { requireAccount } from '../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileRegistryStore,
} from '../../packages/xrpl/src/node.js';

const URL_OF_RATE = `http://127.0.0.1:8790${RATE_PATH}`;

async function main(): Promise<void> {
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const localDir = defaultLocalDir();
  assertOutsideRepository(localDir, repoRoot);
  const confirm = process.argv.includes('--confirm');
  const registry = await fileRegistryStore(join(localDir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run npm run testnet:provision first');
  }
  const agent = requireAccount(registry, 'agent');
  if (agent.seed === undefined) {
    throw new Error('the agent seed is missing from the registry; nothing was sent');
  }
  const wallet = Wallet.fromSeed(agent.seed);
  if (wallet.address !== agent.address) {
    throw new Error('the agent seed does not match its account; nothing was sent');
  }
  if (!confirm) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          url: URL_OF_RATE,
          network: 'XRPL Testnet',
          price: '0.01 XRP',
          note: 'Nothing was paid. Add --confirm to buy one rate.',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const paid = await fetchPaidRate({ url: URL_OF_RATE, wallet });
  process.stdout.write(`${JSON.stringify(paid, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
