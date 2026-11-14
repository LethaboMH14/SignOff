/* eslint-disable security/detect-non-literal-fs-filename -- the operator-named paths are inside the local SignOff folder, checked by assertOutsideRepository */
// Sets up the supplier credential rule on Testnet: the buyer's permissioned domain, a credential the Warden issues to
// the supplier, and the supplier's acceptance of it. A dry run by default: it prints the three steps and sends nothing.
// With --confirm it sends them, then writes the domain into the Warden's configuration. The Warden reads that
// configuration at start-up, so restart it afterwards. Nothing here moves money.
//
//   npm run demo:credential              dry run
//   npm run demo:credential -- --confirm send the three transactions on Testnet
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Wallet } from 'xrpl';

import {
  credentialAcceptTx,
  credentialCreateTx,
  credentialTypeHex,
  permissionedDomainSetTx,
} from '../../packages/xrpl/src/credentials.js';
import type { LedgerPort } from '../../packages/xrpl/src/port.js';
import { connectFirstAvailable, requireAccount } from '../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileRegistryStore,
} from '../../packages/xrpl/src/node.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CREDENTIAL_NAME = 'KYB-APPROVED';

interface Submitted {
  readonly step: string;
  readonly hash: string;
  readonly engineResult: string;
  readonly sequence: number;
}

async function submitSigned(
  port: LedgerPort,
  step: string,
  tx: Parameters<LedgerPort['autofill']>[0],
  wallet: Wallet,
): Promise<Submitted> {
  const prepared = await port.autofill(tx, 1);
  const signed = wallet.sign(prepared);
  const outcome = await port.submit(signed.tx_blob);
  if (!outcome.accepted) {
    throw new Error(`${step} was not accepted: ${outcome.engineResult}`);
  }
  return {
    step,
    hash: signed.hash,
    engineResult: outcome.engineResult,
    sequence: (prepared as { Sequence?: number }).Sequence ?? 0,
  };
}

async function main(): Promise<void> {
  const localDir = defaultLocalDir();
  assertOutsideRepository(localDir, repoRoot);
  const confirm = process.argv.includes('--confirm');

  const registry = await fileRegistryStore(join(localDir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run npm run testnet:provision first');
  }
  const warden = requireAccount(registry, 'warden');
  const supplier = requireAccount(registry, 'supplier');
  if (warden.seed === undefined || supplier.seed === undefined) {
    throw new Error('a seed is missing from the registry; nothing was sent');
  }
  const wardenWallet = Wallet.fromSeed(warden.seed);
  const supplierWallet = Wallet.fromSeed(supplier.seed);
  if (wardenWallet.address !== warden.address || supplierWallet.address !== supplier.address) {
    throw new Error('a seed does not match its account; nothing was sent');
  }

  const credentialType = credentialTypeHex(CREDENTIAL_NAME);
  const domainTx = permissionedDomainSetTx(warden.address, [
    { issuer: warden.address, credentialType },
  ]);
  const createTx = credentialCreateTx(warden.address, supplier.address, credentialType);
  const acceptTx = credentialAcceptTx(supplier.address, warden.address, credentialType);

  if (!confirm) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          credential: CREDENTIAL_NAME,
          steps: [
            'PermissionedDomainSet, signed by the Warden account',
            'CredentialCreate, Warden to the supplier account',
            'CredentialAccept, signed by the supplier account',
          ],
          note: 'Nothing was sent. Add --confirm to send these three transactions on Testnet.',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const port = await connectFirstAvailable();
  try {
    const domain = await submitSigned(port, 'PermissionedDomainSet', domainTx, wardenWallet);
    const created = await submitSigned(port, 'CredentialCreate', createTx, wardenWallet);
    const accepted = await submitSigned(port, 'CredentialAccept', acceptTx, supplierWallet);

    const configPath = join(localDir, 'warden', 'warden-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    config['supplierDomain'] = { owner: warden.address, sequence: domain.sequence };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

    process.stdout.write(
      `${JSON.stringify(
        {
          sent: [domain, created, accepted],
          domainSequence: domain.sequence,
          configWritten: true,
          next: 'Restart the Warden so it reads the supplier domain from its configuration.',
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await port.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
