import { describe, expect, it } from 'vitest';
import { Wallet, type Client } from 'xrpl';
import { FakeClient, FakeLedger, LSF_DISABLE_MASTER } from './helpers/fake-ledger.js';
import { createXrplPort } from '../src/xrpl-port.js';
import {
  provisionTestnet,
  ProvisionError,
  requireAccount,
  type ProvisionDeps,
} from '../src/provision.js';
import { configureSigners, SignerConfigError } from '../src/signers.js';
import { memoryJournalStore, memoryRegistryStore } from '../src/store.js';
import { TEST_TOKEN_TOPUP } from '../src/constants.js';
import type { LedgerPort } from '../src/port.js';
import type { Registry, RegistryAccount } from '../src/registry.js';

interface Env {
  readonly ledger: FakeLedger;
  readonly port: LedgerPort;
  readonly registry: ReturnType<typeof memoryRegistryStore>;
  readonly journal: ReturnType<typeof memoryJournalStore>;
  readonly events: string[];
  readonly deps: ProvisionDeps;
}

/** Narrows a lookup result, failing the test with a clear message when it is missing. */
function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function environment(port?: LedgerPort): Env {
  const ledger = new FakeLedger();
  const client = new FakeClient(ledger);
  const ledgerPort =
    port ?? createXrplPort(client as unknown as Client, 'wss://s.altnet.rippletest.net:51233');
  const registry = memoryRegistryStore();
  const journal = memoryJournalStore();
  const events: string[] = [];
  let counter = 0;
  const deps: ProvisionDeps = {
    port: ledgerPort,
    journal,
    registry,
    now: () => new Date('2026-11-10T10:00:00.000Z'),
    sleep: () => {
      ledger.advance();
      return Promise.resolve();
    },
    pollMs: 0,
    maxPolls: 60,
    newId: () => {
      counter += 1;
      return `id${String(counter)}`;
    },
    newWallet: () => Wallet.generate(),
    log: (event) => {
      events.push(event);
    },
  };
  return { ledger, port: ledgerPort, registry, journal, events, deps };
}

function accountNamed(registry: Registry, role: RegistryAccount['role']): RegistryAccount {
  return must(
    registry.accounts.find((account) => account.role === role),
    `no ${role} account in the registry`,
  );
}

async function provisioned(): Promise<Env> {
  const env = environment();
  await provisionTestnet(env.deps);
  return env;
}

const ADDRESS_PATTERN = /r[1-9A-HJ-NP-Za-km-z]{24,34}/;

describe('provisionTestnet (A1)', () => {
  it('creates, funds and prepares every account, and reports without any address', async () => {
    const env = environment();
    const report = await provisionTestnet(env.deps);
    expect(report.accountsCreated.length).toBe(6);
    expect(report.accountsFunded.length).toBe(6);
    expect(report.issuerDefaultRipple).toBe('set');
    expect(report.trustLines.length).toBe(4);
    expect(report.trustLines.every((line) => line.result === 'set')).toBe(true);
    expect(report.testToken).toEqual({ toppedUp: true, spendingBalance: TEST_TOKEN_TOPUP });
    expect(report.rlusd).toEqual({ spendingBalance: '0', fundingRequired: true });
    expect(JSON.stringify(report)).not.toMatch(ADDRESS_PATTERN);
    expect(env.events).toContain('testnet.account.created');
    expect(env.events).toContain('testnet.test_token.topped_up');
  });

  it('persists every new account to the registry before it is used, with its seed', async () => {
    const env = environment();
    await provisionTestnet(env.deps);
    const registry = must(env.registry.current(), 'registry was not written');
    expect(registry.accounts.length).toBe(6);
    expect(
      registry.accounts.every(
        (account) => account.status === 'active' && account.seed !== undefined,
      ),
    ).toBe(true);
  });

  it('is idempotent: a second run creates, funds and changes nothing', async () => {
    const env = environment();
    await provisionTestnet(env.deps);
    const again = await provisionTestnet(env.deps);
    expect(again.accountsCreated).toEqual([]);
    expect(again.accountsFunded).toEqual([]);
    expect(again.issuerDefaultRipple).toBe('present');
    expect(again.trustLines.every((line) => line.result === 'present')).toBe(true);
    expect(again.testToken.toppedUp).toBe(false);
  });

  it('stops with a clear error when the issuer setting does not validate, and a later run completes it', async () => {
    const env = environment();
    env.ledger.forceNextResult('tecNO_PERMISSION');
    await expect(provisionTestnet(env.deps)).rejects.toThrow(ProvisionError);
    await expect(provisionTestnet(env.deps)).resolves.toBeDefined();
  });

  it('refuses when a funded account never appears on the ledger', async () => {
    const env = environment();
    const silent: LedgerPort = { ...env.port, fund: () => Promise.resolve() };
    await expect(provisionTestnet({ ...env.deps, port: silent, maxPolls: 3 })).rejects.toThrow(
      'did not appear',
    );
  });
});

describe('configureSigners (A2)', () => {
  it('sets the two-signer list, disables the master key, proves the refusal and removes the master seed', async () => {
    const env = await provisioned();
    const report = await configureSigners(env.deps);
    expect(report).toEqual({
      signerList: 'set',
      masterDisabled: true,
      regularKeyAbsent: true,
      masterSignatureRefused: 'tefMASTER_DISABLED',
      masterSeedRemoved: true,
      differences: [],
    });
    const registry = must(env.registry.current(), 'registry was not written');
    const spending = accountNamed(registry, 'spending');
    expect(spending.status).toBe('master-disabled');
    expect(spending.seed).toBeUndefined();
    const onLedger = must(
      env.ledger.account(spending.address),
      'spending account is not on the fake ledger',
    );
    expect(onLedger.flags & LSF_DISABLE_MASTER).toBe(LSF_DISABLE_MASTER);
    expect(onLedger.signerList?.quorum).toBe(2);
    expect(onLedger.signerList?.entries.length).toBe(2);
    expect(onLedger.regularKey).toBeNull();
    const probes = env.journal
      .records()
      .filter((record) => record.paymentId.startsWith('signers.master-probe'));
    const last = probes.at(-1);
    expect(last?.state).toBe('rejected');
    expect(last?.engineResult).toBe('tefMASTER_DISABLED');
  });

  it('is safe to re-run: a configured account is verified, not changed', async () => {
    const env = await provisioned();
    await configureSigners(env.deps);
    const again = await configureSigners(env.deps);
    expect(again.signerList).toBe('present');
    expect(again.masterSignatureRefused).toBe('not-run');
    expect(again.masterSeedRemoved).toBe(false);
    expect(again.masterDisabled).toBe(true);
  });

  it('refuses an account that has a regular key', async () => {
    const env = await provisioned();
    const registry = must(env.registry.current(), 'registry was not written');
    env.ledger.setRegularKey(
      accountNamed(registry, 'spending').address,
      Wallet.generate().publicKey,
    );
    await expect(configureSigners(env.deps)).rejects.toThrow('regular key');
  });

  it('refuses when the spending account is not on the ledger', async () => {
    const env = await provisioned();
    const fresh = environment();
    await fresh.registry.write(must(env.registry.current(), 'registry was not written'));
    await expect(configureSigners(fresh.deps)).rejects.toThrow('not on the ledger');
  });

  it('stops when the signer list does not validate, before the master key is touched', async () => {
    const env = await provisioned();
    env.ledger.forceNextResult('tecOWNERS');
    await expect(configureSigners(env.deps)).rejects.toThrow(ProvisionError);
    const registry = must(env.registry.current(), 'registry was not written');
    expect(accountNamed(registry, 'spending').seed).toBeDefined();
  });

  it('keeps the master seed if a master-signed transaction is not refused', async () => {
    const env = await provisioned();
    let submits = 0;
    const accepting: LedgerPort = {
      ...env.port,
      submit: (blob: string) => {
        submits += 1;
        if (submits === 3) {
          return Promise.resolve({ engineResult: 'tesSUCCESS', accepted: true, applied: true });
        }
        return env.port.submit(blob);
      },
    };
    await expect(configureSigners({ ...env.deps, port: accepting, maxPolls: 3 })).rejects.toThrow(
      SignerConfigError,
    );
    const registry = must(env.registry.current(), 'registry was not written');
    expect(accountNamed(registry, 'spending').seed).toBeDefined();
  });

  it('refuses to run when the spending account has no seed and the master is still enabled', async () => {
    const env = await provisioned();
    const registry = must(env.registry.current(), 'registry was not written');
    const stripped: Registry = {
      ...registry,
      accounts: registry.accounts.map((account) =>
        account.role === 'spending'
          ? {
              role: account.role,
              address: account.address,
              status: account.status,
              createdAt: account.createdAt,
            }
          : account,
      ),
    };
    await env.registry.write(stripped);
    await expect(configureSigners(env.deps)).rejects.toThrow('no seed is held');
  });

  it('gives the spending account the role lookup the flows depend on', async () => {
    const env = await provisioned();
    const registry = must(env.registry.current(), 'registry was not written');
    expect(requireAccount(registry, 'spending').role).toBe('spending');
  });
});
