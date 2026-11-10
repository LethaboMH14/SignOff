import { Wallet, type SubmittableTransaction } from 'xrpl';
import {
  LSF_DEFAULT_RIPPLE,
  RLUSD_TESTNET,
  TEST_TOKEN_CURRENCY,
  TEST_TOKEN_LOW_WATER,
  TEST_TOKEN_TOPUP,
  TRUST_LIMIT_RLUSD,
  TRUST_LIMIT_TEST_TOKEN,
} from './constants.js';
import { compareDecimal, type IssuedAmount } from './amounts.js';
import { buildEnableDefaultRipple, buildIssuedPayment, buildTrustSet } from './transactions.js';
import { describeDecision, sendSingleSigned, type LedgerDeps, type LogFn } from './single.js';
import type { Decision, Expected } from './reconcile.js';
import type { AccountSnapshot, LedgerPort, TokenRef } from './port.js';
import {
  activeAccount,
  emptyRegistry,
  ROLES,
  withAccount,
  type Registry,
  type RegistryAccount,
  type Role,
} from './registry.js';
import type { RegistryStore } from './store.js';

export interface ProvisionDeps extends LedgerDeps {
  readonly registry: RegistryStore;
  readonly newWallet: () => Wallet;
  readonly log: LogFn;
}

export class ProvisionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ProvisionError';
  }
}

export interface ProvisionReport {
  readonly accountsCreated: readonly Role[];
  readonly accountsFunded: readonly Role[];
  readonly issuerDefaultRipple: 'set' | 'present';
  readonly trustLines: readonly {
    readonly role: Role;
    readonly token: 'RLUSD' | 'TST';
    readonly result: 'present' | 'set';
  }[];
  readonly testToken: { readonly toppedUp: boolean; readonly spendingBalance: string };
  readonly rlusd: { readonly spendingBalance: string; readonly fundingRequired: boolean };
}

/** Wallet for a registry account. Refuses when the seed has been removed from the registry. */
export function walletOf(account: RegistryAccount): Wallet {
  if (account.seed === undefined) {
    throw new ProvisionError(`no seed is held for the ${account.role} role`);
  }
  return Wallet.fromSeed(account.seed);
}

/** The in-use account for a role. Throws when provisioning has not created it. */
export function requireAccount(registry: Registry, role: Role): RegistryAccount {
  const account = activeAccount(registry, role);
  if (account === undefined) {
    throw new ProvisionError(`no active ${role} account; run the provision step first`);
  }
  return account;
}

async function requireState(port: LedgerPort, address: string): Promise<AccountSnapshot> {
  const state = await port.account(address);
  if (state === null) {
    throw new ProvisionError('an account in the registry is not on the ledger');
  }
  return state;
}

/** Sends a transaction that must validate successfully. Anything else stops provisioning. */
export async function mustValidate(
  deps: LedgerDeps,
  wallet: Wallet,
  transaction: SubmittableTransaction,
  label: string,
  expected?: Expected,
): Promise<void> {
  const decision: Decision = await sendSingleSigned(deps, wallet, transaction, label, expected);
  if (decision.kind !== 'paid') {
    throw new ProvisionError(`${label} did not validate: ${describeDecision(decision)}`);
  }
}

async function waitForAccount(deps: ProvisionDeps, address: string): Promise<void> {
  for (let poll = 0; poll < deps.maxPolls; poll += 1) {
    if ((await deps.port.account(address)) !== null) {
      return;
    }
    await deps.sleep(deps.pollMs);
  }
  throw new ProvisionError('a funded account did not appear on the ledger in time');
}

async function ensureTrustLine(
  deps: ProvisionDeps,
  holder: RegistryAccount,
  token: TokenRef,
  limit: string,
  name: 'RLUSD' | 'TST',
): Promise<'present' | 'set'> {
  const line = await deps.port.trustLine(holder.address, token);
  if (line !== null && compareDecimal(line.limit, limit) === 0) {
    return 'present';
  }
  await mustValidate(
    deps,
    walletOf(holder),
    buildTrustSet(holder.address, { currency: token.currency, issuer: token.issuer, value: limit }),
    `provision.trust.${holder.role}.${name}`,
  );
  deps.log('testnet.trustline.set', { role: holder.role, currency: name });
  return 'set';
}

/**
 * Creates, funds and prepares the testnet accounts. Safe to run again: it creates and funds only what is
 * missing, and it verifies every setting it relies on before reporting success. Addresses stay in the
 * local registry and never appear in the report.
 */
export async function provisionTestnet(deps: ProvisionDeps): Promise<ProvisionReport> {
  const { port, registry: store, log } = deps;
  let registry = (await store.read()) ?? emptyRegistry();

  const accountsCreated: Role[] = [];
  for (const role of ROLES) {
    if (activeAccount(registry, role) === undefined) {
      const wallet = deps.newWallet();
      if (wallet.seed === undefined) {
        throw new ProvisionError('a generated wallet has no seed');
      }
      registry = withAccount(registry, {
        role,
        address: wallet.address,
        seed: wallet.seed,
        status: 'active',
        createdAt: deps.now().toISOString(),
      });
      await store.write(registry);
      accountsCreated.push(role);
      log('testnet.account.created', { role });
    }
  }

  const accountsFunded: Role[] = [];
  for (const role of ROLES) {
    const account = requireAccount(registry, role);
    if ((await port.account(account.address)) === null) {
      await port.fund(walletOf(account));
      await waitForAccount(deps, account.address);
      accountsFunded.push(role);
      log('testnet.account.funded', { role });
    }
  }

  const issuer = requireAccount(registry, 'issuer');
  const issuerState = await requireState(port, issuer.address);
  let issuerDefaultRipple: 'set' | 'present' = 'present';
  if ((issuerState.flags & LSF_DEFAULT_RIPPLE) === 0) {
    await mustValidate(
      deps,
      walletOf(issuer),
      buildEnableDefaultRipple(issuer.address),
      'provision.default-ripple',
    );
    issuerDefaultRipple = 'set';
  }

  const rlusdToken: TokenRef = { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer };
  const testToken: TokenRef = { currency: TEST_TOKEN_CURRENCY, issuer: issuer.address };
  const trustLines: { role: Role; token: 'RLUSD' | 'TST'; result: 'present' | 'set' }[] = [];
  for (const role of ['spending', 'supplier'] as const) {
    const holder = requireAccount(registry, role);
    trustLines.push({
      role,
      token: 'RLUSD',
      result: await ensureTrustLine(deps, holder, rlusdToken, TRUST_LIMIT_RLUSD, 'RLUSD'),
    });
    trustLines.push({
      role,
      token: 'TST',
      result: await ensureTrustLine(deps, holder, testToken, TRUST_LIMIT_TEST_TOKEN, 'TST'),
    });
  }

  const spending = requireAccount(registry, 'spending');
  const testBefore = (await port.trustLine(spending.address, testToken))?.balance ?? '0';
  let toppedUp = false;
  if (compareDecimal(testBefore, TEST_TOKEN_LOW_WATER) < 0) {
    const topup: IssuedAmount = {
      currency: TEST_TOKEN_CURRENCY,
      issuer: issuer.address,
      value: TEST_TOKEN_TOPUP,
    };
    await mustValidate(
      deps,
      walletOf(issuer),
      buildIssuedPayment(issuer.address, spending.address, topup),
      'provision.test-token.topup',
      { kind: 'iou', amount: topup },
    );
    toppedUp = true;
    log('testnet.test_token.topped_up');
  }
  const testAfter = (await port.trustLine(spending.address, testToken))?.balance ?? '0';

  const rlusdBalance = (await port.trustLine(spending.address, rlusdToken))?.balance ?? '0';
  return {
    accountsCreated,
    accountsFunded,
    issuerDefaultRipple,
    trustLines,
    testToken: { toppedUp, spendingBalance: testAfter },
    rlusd: {
      spendingBalance: rlusdBalance,
      fundingRequired: compareDecimal(rlusdBalance, '0') === 0,
    },
  };
}
