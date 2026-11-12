// The XRPL Testnet credential check (S5). It issues, accepts, reads back and deletes one credential between two test
// accounts that this run creates and funds from the Testnet faucet. Usage, from the repository root:
//   npm run testnet:credential
// The two accounts exist only in memory: their seeds are never printed or written, and only transaction hashes are printed.
// A step that cannot run, because the Credentials amendment is not enabled, no Testnet endpoint answered or the faucet did
// not fund the accounts, is NOT CHECKED (UNVERIFIED) and the run exits 0. A step that runs and does not pass exits 1.
import { Client, Wallet, type SubmittableTransaction } from 'xrpl';

import { testnetEndpoints } from '../../packages/xrpl/src/index.js';
import { type CheckResult, summarizeSynthetic } from '../lib/synthetic-check.js';

/** The Credentials amendment, which the Testnet must have enabled. */
const CREDENTIALS = 'Credentials';
/** The ledger flag that marks a credential as accepted by its subject. */
const LSF_ACCEPTED = 0x00010000;
/** A credential type is hex, at most 64 bytes. */
const CREDENTIAL_TYPE = Buffer.from('SignOffSupplierCheck', 'utf8').toString('hex').toUpperCase();

interface Named {
  readonly name: string;
  readonly result: CheckResult;
}

interface StoredCredential {
  readonly issuer: string;
  readonly credentialType: string;
  readonly flags: number;
}

type Step = () => Promise<CheckResult>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : 'an unknown error';
}

async function connectTestnet(): Promise<{
  readonly client: Client;
  readonly host: string;
} | null> {
  for (const endpoint of testnetEndpoints()) {
    const client = new Client(endpoint, { connectionTimeout: 20_000 });
    try {
      await client.connect();
      return { client, host: new URL(endpoint).host };
    } catch {
      // Try the next endpoint. A client that did not connect is dropped.
      await client.disconnect().catch(() => undefined);
    }
  }
  return null;
}

function storedOf(value: unknown): StoredCredential | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const entry = value as Readonly<Record<string, unknown>>;
  if (entry['LedgerEntryType'] !== 'Credential') {
    return null;
  }
  const issuer = entry['Issuer'];
  const credentialType = entry['CredentialType'];
  const flags = entry['Flags'];
  if (
    typeof issuer !== 'string' ||
    typeof credentialType !== 'string' ||
    typeof flags !== 'number'
  ) {
    return null;
  }
  return { issuer, credentialType, flags };
}

/** The credential that the issuer made for the subject, read back from the subject's account objects, or null. */
async function storedCredentialOf(
  client: Client,
  subject: string,
  issuer: string,
): Promise<StoredCredential | null> {
  const response = await client.request({ command: 'account_objects', account: subject });
  const objects: readonly unknown[] = response.result.account_objects;
  const found = objects
    .map(storedOf)
    .find(
      (entry) =>
        entry !== null && entry.issuer === issuer && entry.credentialType === CREDENTIAL_TYPE,
    );
  return found ?? null;
}

async function submitted(
  client: Client,
  transaction: SubmittableTransaction,
  wallet: Wallet,
): Promise<{ readonly hash: string; readonly code: string }> {
  const response = await client.submitAndWait(transaction, { wallet });
  const meta = response.result.meta;
  const code =
    typeof meta === 'object' && 'TransactionResult' in meta
      ? meta.TransactionResult
      : 'no result code';
  return { hash: response.result.hash, code };
}

async function amendmentStep(client: Client): Promise<CheckResult> {
  const response = await client.request({ command: 'feature' });
  const found = Object.values(response.result.features).find(
    (feature) => feature.name === CREDENTIALS,
  );
  if (found === undefined) {
    return {
      status: 'not-checked',
      detail:
        'the Credentials amendment is not listed by this Testnet endpoint, so the credential was not tried',
    };
  }
  if (!found.enabled) {
    return {
      status: 'not-checked',
      detail:
        'the Credentials amendment is listed but not enabled, so the credential was not tried',
    };
  }
  return { status: 'ok', detail: 'the Credentials amendment is enabled on this Testnet endpoint' };
}

async function fundStep(client: Client, issuer: Wallet, subject: Wallet): Promise<CheckResult> {
  try {
    await client.fundWallet(issuer);
    await client.fundWallet(subject);
  } catch {
    return {
      status: 'not-checked',
      detail: 'the Testnet faucet did not fund the test accounts, so the credential was not tried',
    };
  }
  return {
    status: 'ok',
    detail: 'two test accounts were funded from the Testnet faucet; their seeds stay in memory',
  };
}

async function issueStep(client: Client, issuer: Wallet, subject: Wallet): Promise<CheckResult> {
  const { hash, code } = await submitted(
    client,
    {
      TransactionType: 'CredentialCreate',
      Account: issuer.address,
      Subject: subject.address,
      CredentialType: CREDENTIAL_TYPE,
    },
    issuer,
  );
  if (code !== 'tesSUCCESS') {
    return { status: 'failed', detail: `CredentialCreate returned ${code}, hash ${hash}` };
  }
  const stored = await storedCredentialOf(client, subject.address, issuer.address);
  if (stored === null) {
    return {
      status: 'failed',
      detail: `CredentialCreate validated (hash ${hash}), but the subject account does not hold the credential`,
    };
  }
  if ((stored.flags & LSF_ACCEPTED) !== 0) {
    return {
      status: 'failed',
      detail: 'the credential is marked accepted before the subject accepts it',
    };
  }
  return {
    status: 'ok',
    detail: `CredentialCreate ${code}, hash ${hash}; the subject holds it, not yet accepted`,
  };
}

async function acceptStep(client: Client, issuer: Wallet, subject: Wallet): Promise<CheckResult> {
  const { hash, code } = await submitted(
    client,
    {
      TransactionType: 'CredentialAccept',
      Account: subject.address,
      Issuer: issuer.address,
      CredentialType: CREDENTIAL_TYPE,
    },
    subject,
  );
  if (code !== 'tesSUCCESS') {
    return { status: 'failed', detail: `CredentialAccept returned ${code}, hash ${hash}` };
  }
  return { status: 'ok', detail: `CredentialAccept ${code}, hash ${hash}` };
}

async function checkStep(client: Client, issuer: Wallet, subject: Wallet): Promise<CheckResult> {
  const stored = await storedCredentialOf(client, subject.address, issuer.address);
  if (stored === null) {
    return {
      status: 'failed',
      detail: 'the credential is not on the subject account after it was accepted',
    };
  }
  if ((stored.flags & LSF_ACCEPTED) === 0) {
    return {
      status: 'failed',
      detail: `the credential is not marked accepted (flags ${String(stored.flags)})`,
    };
  }
  return {
    status: 'ok',
    detail: `the subject holds the accepted credential (flags ${String(stored.flags)}), issued by the test issuer`,
  };
}

async function deleteStep(client: Client, issuer: Wallet, subject: Wallet): Promise<CheckResult> {
  const { hash, code } = await submitted(
    client,
    {
      TransactionType: 'CredentialDelete',
      Account: issuer.address,
      Subject: subject.address,
      CredentialType: CREDENTIAL_TYPE,
    },
    issuer,
  );
  if (code !== 'tesSUCCESS') {
    return { status: 'failed', detail: `CredentialDelete returned ${code}, hash ${hash}` };
  }
  const stored = await storedCredentialOf(client, subject.address, issuer.address);
  if (stored !== null) {
    return {
      status: 'failed',
      detail: `CredentialDelete validated (hash ${hash}), but the credential is still on the subject account`,
    };
  }
  return { status: 'ok', detail: `CredentialDelete ${code}, hash ${hash}; the credential is gone` };
}

/** Runs one step. A step that throws is reported as failed with a short message, and the run goes on to report it. */
async function attempt(step: Step): Promise<CheckResult> {
  try {
    return await step();
  } catch (error) {
    return { status: 'failed', detail: `the step threw: ${messageOf(error)}` };
  }
}

function print(checks: readonly Named[]): number {
  const summary = summarizeSynthetic(checks);
  for (const line of summary.lines) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(
    `credential check: ${summary.overall}. Testnet only. The test accounts were made for this run and their seeds were not kept.\n`,
  );
  return summary.exitCode;
}

async function main(): Promise<number> {
  const connected = await connectTestnet();
  if (connected === null) {
    return print([
      {
        name: 'Testnet endpoint',
        result: {
          status: 'not-checked',
          detail: 'no Testnet endpoint answered, so the credential was not tried',
        },
      },
    ]);
  }
  const { client, host } = connected;
  try {
    const issuer = Wallet.generate();
    const subject = Wallet.generate();
    const steps: readonly (readonly [string, Step])[] = [
      ['Credentials amendment', () => amendmentStep(client)],
      ['test accounts', () => fundStep(client, issuer, subject)],
      ['issue', () => issueStep(client, issuer, subject)],
      ['accept', () => acceptStep(client, issuer, subject)],
      ['check', () => checkStep(client, issuer, subject)],
      ['delete', () => deleteStep(client, issuer, subject)],
    ];
    const checks: Named[] = [
      { name: 'Testnet endpoint', result: { status: 'ok', detail: `connected to ${host}` } },
    ];
    let blocker: string | null = null;
    for (const [name, step] of steps) {
      if (blocker !== null) {
        checks.push({ name, result: { status: 'not-checked', detail: `not run: ${blocker}` } });
        continue;
      }
      const result = await attempt(step);
      checks.push({ name, result });
      if (result.status !== 'ok') {
        blocker = result.status === 'not-checked' ? result.detail : `the ${name} step did not pass`;
      }
    }
    return print(checks);
  } finally {
    await client.disconnect();
  }
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  () => {
    // Only a fixed message is printed. A stack trace could show values that do not belong on a screen.
    process.stderr.write('credential check: the run did not finish\n');
    process.exitCode = 1;
  },
);
