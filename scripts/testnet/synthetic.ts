// The synthetic Testnet check. It is read-only: it reads the validated ledger index, the spending account's balance and the
// Warden's health. It submits no payment, signs nothing, and prints no address, seed or key.
// Usage, from the repository root: npm run testnet:synthetic
// Environment: SIGNOFF_SPENDING_ADDRESS (the spending account, read only) and SIGNOFF_WARDEN_URL (the Warden's address).
// A check that is not set up is reported as UNVERIFIED; a check that ran and failed exits with 1.
import {
  connectTestnetPort,
  type LedgerPort,
  testnetEndpoints,
} from '../../packages/xrpl/src/index.js';
import { type CheckResult, summarizeSynthetic } from '../lib/synthetic-check.js';

interface Connected {
  readonly port: LedgerPort;
  readonly host: string;
}

async function connectFirst(): Promise<Connected | null> {
  for (const endpoint of testnetEndpoints()) {
    try {
      return { port: await connectTestnetPort(endpoint), host: new URL(endpoint).host };
    } catch {
      // Try the next endpoint.
    }
  }
  return null;
}

async function ledgerAndAccount(): Promise<{
  readonly ledger: CheckResult;
  readonly account: CheckResult;
}> {
  const connected = await connectFirst();
  if (connected === null) {
    return {
      ledger: { status: 'failed', detail: 'no Testnet endpoint answered' },
      account: {
        status: 'not-checked',
        detail: 'the ledger did not answer, so the account was not read',
      },
    };
  }
  try {
    const index = await connected.port.validatedLedgerIndex();
    const ledger: CheckResult = {
      status: 'ok',
      detail: `validated ledger ${String(index)}, read from ${connected.host}`,
    };
    const address = process.env['SIGNOFF_SPENDING_ADDRESS'];
    if (address === undefined || address === '') {
      return {
        ledger,
        account: { status: 'not-checked', detail: 'SIGNOFF_SPENDING_ADDRESS is not set' },
      };
    }
    const snapshot = await connected.port.account(address);
    if (snapshot === null) {
      return {
        ledger,
        account: { status: 'failed', detail: 'the spending account was not found on Testnet' },
      };
    }
    return {
      ledger,
      account: {
        status: 'ok',
        detail: `spending account readable; balance ${snapshot.balanceDrops} drops`,
      },
    };
  } finally {
    await connected.port.disconnect();
  }
}

async function wardenCheck(): Promise<CheckResult> {
  const base = process.env['SIGNOFF_WARDEN_URL'];
  if (base === undefined || base === '') {
    return { status: 'not-checked', detail: 'SIGNOFF_WARDEN_URL is not set' };
  }
  try {
    const response = await fetch(new URL('/v1/health', base), {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { status: 'failed', detail: `the Warden answered ${String(response.status)}` };
    }
    const body = (await response.json()) as {
      readonly version?: unknown;
      readonly ready?: unknown;
      readonly paused?: unknown;
      readonly policyVersion?: unknown;
    };
    if (body.ready !== true || typeof body.version !== 'string') {
      return { status: 'failed', detail: 'the Warden answered without its version or readiness' };
    }
    const state = body.paused === true ? 'paused' : 'running';
    return {
      status: 'ok',
      detail: `Warden ${body.version} is ready; payments ${state}; rules ${String(body.policyVersion)}`,
    };
  } catch {
    return { status: 'failed', detail: 'the Warden did not answer' };
  }
}

async function main(): Promise<void> {
  const { ledger, account } = await ledgerAndAccount();
  const warden = await wardenCheck();
  const summary = summarizeSynthetic([
    { name: 'validated ledger', result: ledger },
    { name: 'spending account', result: account },
    { name: 'warden health', result: warden },
  ]);
  for (const line of summary.lines) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(`synthetic check: ${summary.overall}. No payment was submitted.\n`);
  process.exitCode = summary.exitCode;
}

main().catch(() => {
  process.stderr.write('synthetic check: the run did not finish\n');
  process.exitCode = 1;
});
