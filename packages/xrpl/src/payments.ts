import { compareDecimal, type IssuedAmount } from './amounts.js';
import { LSF_DISABLE_MASTER, RLUSD_TESTNET, TEST_TOKEN_CURRENCY } from './constants.js';
import type { Decision, Expected } from './reconcile.js';
import { requireAccount, walletOf } from './provision.js';
import { assertSignedExactly, combineSigned, hashOfSigned, signAsSigner } from './multisig.js';
import type { LedgerPort } from './port.js';
import { diffSignerList } from './signer-list.js';
import { sendAndReconcile, type SendPlan } from './reliable.js';
import type { LedgerDeps, LogFn } from './single.js';
import { desiredSignerList } from './signers.js';
import type { Registry, RegistryAccount } from './registry.js';
import type { RegistryStore } from './store.js';
import { buildIssuedPayment, buildXrpPayment } from './transactions.js';

/** What a transfer moves: an issued currency, or XRP in drops. */
export type Amount =
  | { readonly kind: 'iou'; readonly amount: IssuedAmount }
  | { readonly kind: 'xrp'; readonly drops: string };

/** One payment from an account to another. The paymentId keys the journal and must stay stable across attempts. */
export interface Transfer {
  readonly paymentId: string;
  readonly from: RegistryAccount;
  readonly to: RegistryAccount;
  readonly amount: Amount;
}

export interface PaymentDeps extends LedgerDeps {
  readonly registry: RegistryStore;
  /** How many fresh attempts may follow an expired one. An unknown outcome is never retried this way. */
  readonly maxAttempts: number;
  readonly log: LogFn;
}

export interface Signers {
  readonly agent: RegistryAccount;
  readonly warden: RegistryAccount;
}

export interface TransferOutcome {
  readonly paymentId: string;
  readonly attempts: number;
  readonly decision: Decision;
  readonly hash: string | null;
}

export class PaymentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PaymentError';
  }
}

function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new PaymentError(message);
  }
  return value;
}

/** The value a transfer must deliver, for the reconciliation check. */
export function expectedOf(amount: Amount): Expected {
  return amount.kind === 'iou'
    ? { kind: 'iou', amount: amount.amount }
    : { kind: 'xrp', drops: amount.drops };
}

/** The unsigned Payment for a transfer. */
export function transactionOf(transfer: Transfer) {
  return transfer.amount.kind === 'iou'
    ? buildIssuedPayment(transfer.from.address, transfer.to.address, transfer.amount.amount)
    : buildXrpPayment(transfer.from.address, transfer.to.address, transfer.amount.drops);
}

/** Test-token amount, issued by the registry's issuer account. */
export function testTokenAmount(issuer: RegistryAccount, value: string): Amount {
  return { kind: 'iou', amount: { currency: TEST_TOKEN_CURRENCY, issuer: issuer.address, value } };
}

/** Testnet RLUSD amount. Only meaningful once the spending account holds testnet RLUSD. */
export function rlusdAmount(value: string): Amount {
  return {
    kind: 'iou',
    amount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value },
  };
}

/** The agent and warden accounts. Both must be registered before a payment can be signed. */
export async function loadSigners(deps: PaymentDeps): Promise<Signers> {
  const registry: Registry = must(
    await deps.registry.read(),
    'no registry; run the provision step first',
  );
  return { agent: requireAccount(registry, 'agent'), warden: requireAccount(registry, 'warden') };
}

/**
 * Refuses to pay unless the ledger shows the configuration the design requires: master key disabled,
 * no regular key, and exactly the Agent and Warden signer list. Checked on the ledger, every time.
 */
export async function assertSignerConfiguration(
  port: LedgerPort,
  account: RegistryAccount,
  signers: Signers,
): Promise<void> {
  const state = await port.account(account.address);
  if (state === null) {
    throw new PaymentError('the paying account is not on the ledger');
  }
  if ((state.flags & LSF_DISABLE_MASTER) === 0) {
    throw new PaymentError(
      'the master key is still enabled on the paying account; configure signers first',
    );
  }
  if (state.regularKeyPresent) {
    throw new PaymentError('a regular key is set on the paying account');
  }
  const differences = diffSignerList(
    desiredSignerList(signers.agent, signers.warden),
    state.signerList,
  );
  if (differences.length > 0) {
    throw new PaymentError(`the signer list does not match the design (${differences.join(', ')})`);
  }
}

/**
 * Builds the two-signature plan for one attempt. The Agent and Warden each sign the same autofilled
 * transaction, the blobs are combined, and the result is checked to carry exactly those two signers.
 */
export async function planTwoSignature(
  deps: LedgerDeps,
  transfer: Transfer,
  signers: Signers,
  attempt: number,
): Promise<SendPlan> {
  const prepared = await deps.port.autofill(transactionOf(transfer), 2);
  const lastLedgerSequence = prepared.LastLedgerSequence;
  if (lastLedgerSequence === undefined) {
    throw new PaymentError('autofill did not set LastLedgerSequence');
  }
  const txBlob = combineSigned([
    signAsSigner(walletOf(signers.agent), prepared),
    signAsSigner(walletOf(signers.warden), prepared),
  ]);
  assertSignedExactly(txBlob, [signers.agent.address, signers.warden.address]);
  return {
    paymentId: transfer.paymentId,
    attempt,
    txBlob,
    hash: hashOfSigned(txBlob),
    lastLedgerSequence,
    expected: expectedOf(transfer.amount),
  };
}

/**
 * Sends a two-signature transfer. An expired attempt is replaced by a fresh one, up to maxAttempts; any
 * other outcome, including 'wait' (the poll budget ran out), stops the loop, because only an expired
 * attempt is known to be dead.
 */
export async function sendTwoSignatureTransfer(
  deps: PaymentDeps,
  transfer: Transfer,
): Promise<TransferOutcome> {
  const signers = await loadSigners(deps);
  await assertSignerConfiguration(deps.port, transfer.from, signers);
  let hash: string | null = null;
  for (let attempt = 1; attempt <= deps.maxAttempts; attempt += 1) {
    const plan = await planTwoSignature(deps, transfer, signers, attempt);
    hash = plan.hash;
    const decision = await sendAndReconcile(plan, deps);
    if (decision.kind !== 'expired') {
      return { paymentId: transfer.paymentId, attempts: attempt, decision, hash };
    }
    deps.log('payment_attempt_expired', { attempt });
  }
  return {
    paymentId: transfer.paymentId,
    attempts: deps.maxAttempts,
    decision: { kind: 'expired' },
    hash,
  };
}

/** The balance the recipient holds of the transferred asset, as a decimal string. */
export async function deliveredBalance(
  port: LedgerPort,
  account: RegistryAccount,
  amount: Amount,
): Promise<string> {
  if (amount.kind === 'xrp') {
    return (await port.account(account.address))?.balanceDrops ?? '0';
  }
  const line = await port.trustLine(account.address, {
    currency: amount.amount.currency,
    issuer: amount.amount.issuer,
  });
  return line?.balance ?? '0';
}

/** True when two balances are equal. Both are non-negative decimal strings. */
export function sameBalance(a: string, b: string): boolean {
  return compareDecimal(a, b) === 0;
}
