// Sets up the high-value (treasury) account on XRPL Testnet: a new account whose signer list is agent, Warden
// and the owner's Xaman account, quorum 3, master key disabled, with an RLUSD trust line, funded with Testnet
// RLUSD moved from the spending account (agent + Warden sign). Then it adds the high-value route to the local
// Warden's configuration, after a backup.
//
//   npm run testnet:high-value -- [--rlusd 4] [--threshold-minor 300]
//
// Reads XAMAN_APPROVER_ADDRESS from .env. Prints roles, addresses (public), result codes and hashes; never a seed.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccountSetAsfFlags, Client, isValidClassicAddress, Wallet, type Payment } from 'xrpl';

import { RLUSD_TESTNET } from '../../packages/xrpl/src/constants.js';
import {
  assertSignedExactly,
  combineSigned,
  signAsSigner,
} from '../../packages/xrpl/src/multisig.js';
import { defaultLocalDir } from '../../packages/xrpl/src/node.js';

const TESTNET = 'wss://s.altnet.rippletest.net:51233';
const log = (line: string): void => {
  console.log(`[high-value] ${line}`);
};

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

interface RegistryEntry {
  readonly role: string;
  readonly status: string;
  readonly address: string;
  readonly seed?: string;
}

function resultOf(meta: unknown): string {
  return typeof meta === 'object' && meta !== null && 'TransactionResult' in meta
    ? String(meta.TransactionResult)
    : 'unknown';
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const owner = process.env['XAMAN_APPROVER_ADDRESS']?.trim() ?? '';
  if (!isValidClassicAddress(owner)) {
    throw new Error('set XAMAN_APPROVER_ADDRESS in .env to the owner Xaman Testnet address');
  }
  const rlusd = argOf('--rlusd', '4');
  const thresholdMinor = Number(argOf('--threshold-minor', '300'));
  const dir = defaultLocalDir();
  // The local Testnet folder outside the repository, the same one the provisioning step writes.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as {
    accounts: RegistryEntry[];
  };
  const active = (role: string): RegistryEntry => {
    const found = registry.accounts.find(
      (a) => a.role === role && a.status !== 'abandoned' && a.status !== 'retired',
    );
    if (found === undefined) throw new Error(`no ${role} account in the registry`);
    return found;
  };
  const agentEntry = active('agent');
  const wardenEntry = active('warden');
  const spending = registry.accounts.find(
    (a) => a.role === 'spending' && a.status === 'master-disabled',
  );
  if (spending === undefined || agentEntry.seed === undefined || wardenEntry.seed === undefined) {
    throw new Error('the registry lacks the spending account or the agent and Warden keys');
  }
  const agent = Wallet.fromSeed(agentEntry.seed);
  const warden = Wallet.fromSeed(wardenEntry.seed);

  const client = new Client(TESTNET);
  await client.connect();
  try {
    const treasury = Wallet.generate();
    await client.fundWallet(treasury);
    log(`treasury account funded with Testnet XRP: ${treasury.address}`);

    const trust = await client.submitAndWait(
      {
        TransactionType: 'TrustSet',
        Account: treasury.address,
        LimitAmount: {
          currency: RLUSD_TESTNET.currency,
          issuer: RLUSD_TESTNET.issuer,
          value: '1000',
        },
      },
      { wallet: treasury, autofill: true },
    );
    log(`RLUSD trust line: ${resultOf(trust.result.meta)}`);

    const list = await client.submitAndWait(
      {
        TransactionType: 'SignerListSet',
        Account: treasury.address,
        SignerQuorum: 3,
        SignerEntries: [agent.address, warden.address, owner].map((Account) => ({
          SignerEntry: { Account, SignerWeight: 1 },
        })),
      },
      { wallet: treasury, autofill: true },
    );
    log(`signer list agent + Warden + owner, quorum 3: ${resultOf(list.result.meta)}`);

    const master = await client.submitAndWait(
      {
        TransactionType: 'AccountSet',
        Account: treasury.address,
        SetFlag: AccountSetAsfFlags.asfDisableMaster,
      },
      { wallet: treasury, autofill: true },
    );
    log(`master key disabled: ${resultOf(master.result.meta)}`);

    const move: Payment = {
      TransactionType: 'Payment',
      Account: spending.address,
      Destination: treasury.address,
      Amount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value: rlusd },
    };
    const prepared = await client.autofill(move, 2);
    const blob = combineSigned([signAsSigner(agent, prepared), signAsSigner(warden, prepared)]);
    assertSignedExactly(blob, [agent.address, warden.address]);
    const moved = await client.submitAndWait(blob);
    log(
      `moved ${rlusd} Testnet RLUSD from spending to treasury (agent + Warden): ${resultOf(moved.result.meta)}, hash ${moved.result.hash}`,
    );

    // The local Testnet folder outside the repository, the same one the provisioning step writes.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(
      join(dir, 'high-value.json'),
      `${JSON.stringify({ treasuryAddress: treasury.address, ownerAddress: owner, createdAt: new Date().toISOString(), fundingHash: moved.result.hash }, null, 2)}\n`,
    );

    const configPath = join(dir, 'warden', 'warden-config.json');
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    copyFileSync(configPath, `${configPath}.bak-${stamp}-before-high-value`);
    // The local Testnet folder outside the repository, the same one the provisioning step writes.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    config['highValue'] = {
      thresholdMinor,
      treasuryAddress: treasury.address,
      ownerAddress: owner,
      approvalWindowLedgers: 300,
    };
    // The local Testnet folder outside the repository, the same one the provisioning step writes.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    log(
      `local Warden configured: payments of ${String(thresholdMinor)} minor units or more need the owner`,
    );
  } finally {
    await client.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`[high-value] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
