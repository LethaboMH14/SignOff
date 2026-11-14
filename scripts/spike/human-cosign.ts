// Spike: a high-value (treasury) account that needs THREE signatures: agent, Warden and a human approver.
// Testnet only. It uses fresh throwaway faucet accounts, never the demo's registry, keys or RLUSD.
// Output: roles, result codes and transaction hashes. Seeds stay in memory and are never printed.
//
//   npx tsx scripts/spike/human-cosign.ts                 # the human key is a local stand-in
//   npx tsx scripts/spike/human-cosign.ts --human xaman   # the human signs on their phone in Xaman
//
// Xaman mode reads XAMAN_API_KEY, XAMAN_API_SECRET and XAMAN_APPROVER_ADDRESS (the approver's Testnet
// r-address in the Xaman app) from .env, plus XAMAN_USER_TOKEN if a push token is already known.
import { appendFileSync, existsSync } from 'node:fs';
import { decode, Client, Wallet, type Payment, type SignerListSet, type AccountSet } from 'xrpl';
import { AccountSetAsfFlags } from 'xrpl';
import {
  assertSignedExactly,
  combineSigned,
  hashOfSigned,
  signAsSigner,
} from '../../packages/xrpl/src/multisig.js';

const TESTNET = 'wss://s.altnet.rippletest.net:51233';
const XAMAN_API = 'https://xumm.app/api/v1/platform';
// A person needs minutes, not seconds: about 300 ledgers is roughly 15 to 20 minutes on Testnet.
const HUMAN_WINDOW_LEDGERS = 300;

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const mode =
  (process.argv.includes('--human')
    ? process.argv[process.argv.indexOf('--human') + 1]
    : undefined) ?? 'local';
const log = (line: string): void => {
  console.log(`[spike] ${line}`);
};

/** The engine result recorded in a validated transaction's metadata. */
function resultCode(meta: unknown): string {
  return typeof meta === 'object' && meta !== null && 'TransactionResult' in meta
    ? String(meta.TransactionResult)
    : 'unknown';
}

async function submitSingle(
  client: Client,
  wallet: Wallet,
  tx: SignerListSet | AccountSet,
): Promise<string> {
  const result = await client.submitAndWait(tx, { wallet, autofill: true });
  return resultCode(result.result.meta);
}

/** Asks Xaman to collect the approver's multisign signature on their phone, and waits for it. */
async function xamanSignature(tx: Payment): Promise<string> {
  const key = env['XAMAN_API_KEY'];
  const secret = env['XAMAN_API_SECRET'];
  const approver = env['XAMAN_APPROVER_ADDRESS'];
  if (!key || !secret || !approver) {
    throw new Error(
      'Xaman mode needs XAMAN_API_KEY, XAMAN_API_SECRET and XAMAN_APPROVER_ADDRESS in .env',
    );
  }
  const headers = { 'Content-Type': 'application/json', 'X-API-Key': key, 'X-API-Secret': secret };
  const body = {
    txjson: tx,
    options: {
      multisign: true,
      submit: false,
      signers: [approver],
      force_network: 'TESTNET',
      expire: 15,
    },
    custom_meta: {
      instruction: 'SignOff (Testnet): approve a high-value supplier payment as the owner.',
    },
    ...(env['XAMAN_USER_TOKEN'] ? { user_token: env['XAMAN_USER_TOKEN'] } : {}),
  };
  const created = await fetch(`${XAMAN_API}/payload`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!created.ok)
    throw new Error(
      `Xaman refused the payload: HTTP ${String(created.status)} ${await created.text()}`,
    );
  const payload = (await created.json()) as {
    uuid: string;
    next: { always: string };
    pushed?: boolean;
  };
  log(`Xaman sign request created. Pushed to phone: ${String(payload.pushed ?? false)}`);
  log(`Open on the phone (or scan the QR at this link): ${payload.next.always}`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${XAMAN_API}/payload/${payload.uuid}`, { headers });
    const state = (await res.json()) as {
      meta: { resolved: boolean; signed: boolean; expired: boolean };
      response: { hex: string | null; account: string | null; user_token?: string | null };
      application?: { issued_user_token?: string | null };
    };
    if (state.meta.expired) throw new Error('the approval request expired; the payment stays held');
    if (!state.meta.resolved) continue;
    if (!state.meta.signed || !state.response.hex)
      throw new Error('the owner rejected the payment; it stays held');
    const token = state.application?.issued_user_token;
    if (token && !env['XAMAN_USER_TOKEN']) {
      appendFileSync('.env', `\nXAMAN_USER_TOKEN=${token}\n`);
      log('Xaman issued a push token; saved to .env as XAMAN_USER_TOKEN (not printed).');
    }
    return state.response.hex;
  }
}

async function main(): Promise<void> {
  if (mode === 'xaman') {
    const missing = [
      env['XAMAN_API_KEY'] ? '' : 'XAMAN_API_KEY',
      env['XAMAN_API_SECRET'] ? '' : 'XAMAN_API_SECRET',
      env['XAMAN_APPROVER_ADDRESS'] ? '' : 'XAMAN_APPROVER_ADDRESS',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`add ${missing.join(', ')} to .env first; nothing was sent`);
    }
  }
  const client = new Client(TESTNET);
  await client.connect();
  try {
    log('Funding a throwaway treasury account and payee from the Testnet faucet');
    const { wallet: treasury } = await client.fundWallet();
    const { wallet: payee } = await client.fundWallet();
    const agent = Wallet.generate();
    const warden = Wallet.generate();
    const humanLocal = Wallet.generate();
    const humanAddress =
      mode === 'xaman' ? (env['XAMAN_APPROVER_ADDRESS'] ?? '') : humanLocal.address;
    if (!humanAddress) throw new Error('set XAMAN_APPROVER_ADDRESS in .env for Xaman mode');

    const listResult = await submitSingle(client, treasury, {
      TransactionType: 'SignerListSet',
      Account: treasury.address,
      SignerQuorum: 3,
      SignerEntries: [agent.address, warden.address, humanAddress].map((Account) => ({
        SignerEntry: { Account, SignerWeight: 1 },
      })),
    });
    log(`Signer list agent + Warden + human, quorum 3: ${listResult}`);
    const masterResult = await submitSingle(client, treasury, {
      TransactionType: 'AccountSet',
      Account: treasury.address,
      SetFlag: AccountSetAsfFlags.asfDisableMaster,
    });
    log(`Master key disabled: ${masterResult}`);

    const base: Payment = {
      TransactionType: 'Payment',
      Account: treasury.address,
      Destination: payee.address,
      Amount: '1000000', // 1 XRP, standing in for a R100,000 invoice
    };
    const tx = await client.autofill(base, 3);
    tx.LastLedgerSequence = (await client.getLedgerIndex()) + HUMAN_WINDOW_LEDGERS;

    const agentBlob = signAsSigner(agent, tx);
    const wardenBlob = signAsSigner(warden, tx);

    // 1. Without the human: the ledger must refuse it.
    const twoOnly = combineSigned([agentBlob, wardenBlob]);
    const refused = await client.request({ command: 'submit', tx_blob: twoOnly });
    log(`Agent + Warden only (no human): ${refused.result.engine_result}`);

    // 2. With the human.
    const humanBlob = mode === 'xaman' ? await xamanSignature(tx) : signAsSigner(humanLocal, tx);
    const humanSigners = (decode(humanBlob) as { Signers?: unknown[] }).Signers?.length ?? 0;
    log(`Human signature received (${mode}); signers in that blob: ${String(humanSigners)}`);
    const all = combineSigned([agentBlob, wardenBlob, humanBlob]);
    assertSignedExactly(all, [agent.address, warden.address, humanAddress]);
    const hash = hashOfSigned(all);
    const done = await client.submitAndWait(all);
    const code = resultCode(done.result.meta);
    log(`Agent + Warden + human: ${code}, validated in ledger ${String(done.result.ledger_index)}`);
    log(`Hash: ${hash}`);
    log(`Explorer: https://testnet.xrpl.org/transactions/${hash}`);
  } finally {
    await client.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`[spike] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
