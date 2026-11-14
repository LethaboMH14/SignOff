/* eslint-disable security/detect-non-literal-fs-filename -- the operator-named paths are inside the local SignOff folder, checked by assertOutsideRepository */
// Enrols the demo supplier in the running Warden: operator A enrols the payee, operator B approves it. The payee is
// the registry's supplier account, and the Warden checks it against its own enrolment before every co-signature.
// Usage: npm run demo:enrol   (needs the Warden running; refuses if the supplier is already enrolled)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { generateSupplierKey, WardenClient } from '../../apps/warden/src/client.js';
import { requireAccount } from '../../packages/xrpl/src/index.js';
import { defaultLocalDir, fileRegistryStore } from '../../packages/xrpl/src/node.js';
import { DEMO_INVOICE, DEMO_LISTEN } from './prepare.js';

const CALLERS = z.strictObject({
  schemaVersion: z.literal(1),
  principals: z.array(
    z.strictObject({ id: z.string(), role: z.enum(['agent', 'operator']), secret: z.string() }),
  ),
});

function operatorClient(callers: z.infer<typeof CALLERS>, id: string): WardenClient {
  const principal = callers.principals.find((entry) => entry.id === id);
  if (principal === undefined) {
    throw new Error(`the Warden callers file has no ${id}`);
  }
  return new WardenClient({
    baseUrl: `http://${DEMO_LISTEN.host}:${String(DEMO_LISTEN.port)}`,
    principalId: id,
    secret: Buffer.from(principal.secret, 'base64'),
  });
}

async function main(): Promise<void> {
  const localDir = defaultLocalDir();
  const callers = CALLERS.parse(
    JSON.parse(readFileSync(join(localDir, 'warden', 'warden-callers.json'), 'utf8')) as unknown,
  );
  const registry = await fileRegistryStore(join(localDir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run npm run testnet:provision first');
  }
  const supplier = requireAccount(registry, 'supplier');
  const operatorA = operatorClient(callers, 'operator-a');
  const operatorB = operatorClient(callers, 'operator-b');
  const health = await operatorA.health();
  if (!health.ready) {
    throw new Error('the Warden is not ready; start it first with npm run demo:warden');
  }
  const key = generateSupplierKey();
  await operatorA.enrolSupplier({
    supplierId: DEMO_INVOICE.supplierId,
    payee: { address: supplier.address, destinationTag: null },
    publicKey: key.publicKey,
  });
  await operatorB.approveSupplier(DEMO_INVOICE.supplierId);
  process.stdout.write(
    `${JSON.stringify({ enrolled: DEMO_INVOICE.supplierId, approvedBy: ['operator-a', 'operator-b'] }, null, 2)}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
