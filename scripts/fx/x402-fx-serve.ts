// Serves the paid USD/ZAR rate on 127.0.0.1 for the agent to buy. The price is paid in XRP on the Testnet to the
// project's reserve account, and the hosted Testnet facilitator verifies and settles each payment. Nothing is paid by
// starting this server; a payment is made only when the agent buys a rate (npm run fx:x402:buy -- --confirm).
import { join } from 'node:path';

import { createFxMerchant } from '../../apps/agent/src/fx/x402-merchant.js';
import { requireAccount } from '../../packages/xrpl/src/index.js';
import { defaultLocalDir, fileRegistryStore } from '../../packages/xrpl/src/node.js';

const HOST = '127.0.0.1';
const PORT = 8790;
/** The hosted Testnet facilitator, as the x402 XRPL documentation names it. */
const FACILITATOR_URL = 'https://xrpl-facilitator-testnet.t54.ai';
/** 0.01 XRP per rate. */
const PRICE_DROPS = '10000';

async function main(): Promise<void> {
  const registry = await fileRegistryStore(join(defaultLocalDir(), 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run npm run testnet:provision first');
  }
  const reserve = requireAccount(registry, 'reserve');
  const app = createFxMerchant({
    payTo: reserve.address,
    facilitatorUrl: FACILITATOR_URL,
    priceDrops: PRICE_DROPS,
  });
  await new Promise<void>((listening) => {
    app.listen(PORT, HOST, () => {
      listening();
    });
  });
  process.stdout.write(
    `paid FX rate on http://${HOST}:${String(PORT)}/fx/usd-zar, ${PRICE_DROPS} drops per rate on XRPL Testnet\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
