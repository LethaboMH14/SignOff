import type { ProvisionDeps } from './provision.js';
import { randomUUID } from 'node:crypto';
import { compareDecimal, type IssuedAmount } from './amounts.js';
import { TEST_TOKEN_CURRENCY } from './constants.js';
import {
  mustValidate,
  provisionTestnet,
  requireAccount,
  walletOf,
  type ProvisionReport,
} from './provision.js';
import { configureSigners, type SignerReport } from './signers.js';
import { buildXrpPayment } from './transactions.js';
import {
  sendTwoSignatureTransfer,
  type Amount,
  type PaymentDeps,
  type TransferOutcome,
} from './payments.js';
import type { RegistryAccount } from './registry.js';
import { withAccount, type Registry } from './registry.js';
import type { LedgerPort } from './port.js';

export interface RebuildOptions {
  /** XRP sent from the reserve to the new spending account. Must cover the reserves for its objects. */
  readonly fundingDrops: string;
  /** The payment that proves the rebuilt account works. */
  readonly paymentAmount: Amount;
  /** XRP the abandoned account keeps above its reserve, to pay the refund's own fee. */
  readonly refundMarginDrops: string;
}

export interface RebuildReport {
  readonly abandoned: 'spending';
  readonly newSpendingFunded: boolean;
  readonly provisioned: ProvisionReport;
  readonly signers: SignerReport;
  readonly payment: TransferOutcome;
  readonly refundXrp: TransferOutcome | 'nothing-to-refund';
  readonly refundToken: TransferOutcome | 'nothing-to-refund';
}

/** Reserve the ledger requires for an account with this many owner objects, in drops. */
function reserveDrops(baseDrops: string, incrementDrops: string, ownerCount: number): bigint {
  return BigInt(baseDrops) + BigInt(incrementDrops) * BigInt(ownerCount);
}

/**
 * Rebuilds the spending account from the reserve after the current one is abandoned. Steps: pause the
 * old account by marking it abandoned, fund a new spending account from the reserve, reuse the
 * idempotent provisioning for its trust lines and test tokens, configure its signers, prove it with a
 * two-signature payment, and then refund what the abandoned account still holds to the reserve and
 * issuer. The old account is not signed again except by the refund, which needs both keys.
 */
export async function rebuildFromReserve(
  deps: ProvisionDeps & PaymentDeps,
  options: RebuildOptions,
): Promise<RebuildReport> {
  const { port, registry: store } = deps;
  const current = await store.read();
  if (current === null) {
    throw new Error('no registry; run the provision step first');
  }
  const oldSpending = requireAccount(current, 'spending');
  const reserve = requireAccount(current, 'reserve');
  const supplier = requireAccount(current, 'supplier');
  const issuer = requireAccount(current, 'issuer');
  const agent = requireAccount(current, 'agent');
  const warden = requireAccount(current, 'warden');

  const paused: RegistryAccount = { ...oldSpending, status: 'abandoned' };
  let registry: Registry = withAccount(current, paused);
  await store.write(registry);
  deps.log('rebuild_old_account_paused');

  const wallet = deps.newWallet();
  if (wallet.seed === undefined) {
    throw new Error('a generated wallet has no seed');
  }
  const newSpending: RegistryAccount = {
    role: 'spending',
    address: wallet.address,
    seed: wallet.seed,
    status: 'active',
    createdAt: deps.now().toISOString(),
  };
  registry = withAccount(registry, newSpending);
  await store.write(registry);
  deps.log('rebuild_new_account_created');

  await mustValidate(
    deps,
    walletOf(reserve),
    buildXrpPayment(reserve.address, newSpending.address, options.fundingDrops),
    'rebuild.fund',
    { kind: 'xrp', drops: options.fundingDrops },
  );
  deps.log('rebuild_new_account_funded');

  const provisioned = await provisionTestnet(deps);
  const signers = await configureSigners(deps);
  const payment = await sendTwoSignatureTransfer(deps, {
    paymentId: `rebuild.payment.${randomUUID()}`,
    from: newSpending,
    to: supplier,
    amount: options.paymentAmount,
  });

  const refundXrp = await refundXrpFrom(
    deps,
    port,
    oldSpending,
    { agent, warden, reserve },
    options.refundMarginDrops,
  );
  const refundToken = await refundTokenFrom(deps, port, oldSpending, { agent, warden, issuer });
  return {
    abandoned: 'spending',
    newSpendingFunded: true,
    provisioned,
    signers,
    payment,
    refundXrp,
    refundToken,
  };
}

async function refundXrpFrom(
  deps: ProvisionDeps & PaymentDeps,
  port: LedgerPort,
  abandoned: RegistryAccount,
  to: {
    readonly agent: RegistryAccount;
    readonly warden: RegistryAccount;
    readonly reserve: RegistryAccount;
  },
  marginDrops: string,
): Promise<TransferOutcome | 'nothing-to-refund'> {
  const state = await port.account(abandoned.address);
  if (state === null) {
    return 'nothing-to-refund';
  }
  const { baseDrops, incrementDrops } = await port.reserves();
  const floor = reserveDrops(baseDrops, incrementDrops, state.ownerCount) + BigInt(marginDrops);
  const spendable = BigInt(state.balanceDrops) - floor;
  if (spendable <= 0n) {
    return 'nothing-to-refund';
  }
  return sendTwoSignatureTransfer(deps, {
    paymentId: `rebuild.refund-xrp.${randomUUID()}`,
    from: abandoned,
    to: to.reserve,
    amount: { kind: 'xrp', drops: spendable.toString() },
  });
}

async function refundTokenFrom(
  deps: ProvisionDeps & PaymentDeps,
  port: LedgerPort,
  abandoned: RegistryAccount,
  to: {
    readonly agent: RegistryAccount;
    readonly warden: RegistryAccount;
    readonly issuer: RegistryAccount;
  },
): Promise<TransferOutcome | 'nothing-to-refund'> {
  const line = await port.trustLine(abandoned.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer: to.issuer.address,
  });
  if (line === null || compareDecimal(line.balance, '0') === 0) {
    return 'nothing-to-refund';
  }
  const amount: IssuedAmount = {
    currency: TEST_TOKEN_CURRENCY,
    issuer: to.issuer.address,
    value: line.balance,
  };
  return sendTwoSignatureTransfer(deps, {
    paymentId: `rebuild.refund-token.${randomUUID()}`,
    from: abandoned,
    to: to.issuer,
    amount: { kind: 'iou', amount },
  });
}
