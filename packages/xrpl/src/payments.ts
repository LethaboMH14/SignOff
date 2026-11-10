import { decode } from 'xrpl';
import { compareDecimal, sameIouAmount, type IssuedAmount } from './amounts.js';
import { LSF_DISABLE_MASTER, RLUSD_TESTNET, TEST_TOKEN_CURRENCY } from './constants.js';
import { nextStep, replay, type JournalRecord, type PaymentView } from './journal.js';
import type { Decision, Expected } from './reconcile.js';
import { requireAccount, walletOf } from './provision.js';
import { assertSignedExactly, combineSigned, hashOfSigned, signAsSigner } from './multisig.js';
import type { LedgerPort } from './port.js';
import { diffSignerList } from './signer-list.js';
import {
  resumeAndReconcile,
  sendAndReconcile,
  type JournalSink,
  type SendPlan,
} from './reliable.js';
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

/** What the journal already holds for a payment id. It is decided before anything is signed or sent. */
export type PriorAttempt =
  | { readonly kind: 'none' }
  | { readonly kind: 'settled'; readonly view: PaymentView }
  | { readonly kind: 'unresolved'; readonly view: PaymentView }
  | { readonly kind: 'expired'; readonly view: PaymentView };

/** Reads the journal for one payment id and classifies it. A journal that does not replay is an error. */
export async function priorAttemptOf(
  journal: JournalSink,
  paymentId: string,
): Promise<PriorAttempt> {
  const view = replay(await journal.readAll()).get(paymentId);
  if (view === undefined) {
    return { kind: 'none' };
  }
  switch (nextStep(view)) {
    case 'submit':
    case 'reconcile':
      return { kind: 'unresolved', view };
    case 'new-attempt':
      return { kind: 'expired', view };
    case 'none':
      return { kind: 'settled', view };
  }
}

/** The attempt number a send starts from, given what the journal already holds. */
function firstAttemptOf(prior: PriorAttempt): number {
  switch (prior.kind) {
    case 'none':
      return 1;
    case 'unresolved':
      return prior.view.attempt;
    case 'expired':
      return prior.view.attempt + 1;
    case 'settled':
      throw new PaymentError('a settled payment has no attempt to start');
  }
}

/** The fields of a signed Payment that identify its terms. */
interface SignedTerms {
  readonly Account: string;
  readonly Destination: string;
  readonly Amount:
    string | { readonly currency: string; readonly issuer: string; readonly value: string };
}

/**
 * Throws unless a signed blob moves exactly the terms of this transfer. A payment id names one obligation,
 * so a stored attempt with other terms is never resumed and never reported as the answer to this request.
 */
export function assertSameTerms(blob: string, transfer: Transfer): void {
  const terms = decode(blob) as unknown as SignedTerms;
  const sameParties =
    terms.Account === transfer.from.address && terms.Destination === transfer.to.address;
  const sameAmount =
    transfer.amount.kind === 'xrp'
      ? typeof terms.Amount === 'string' && terms.Amount === transfer.amount.drops
      : typeof terms.Amount !== 'string' &&
        sameIouAmount(transfer.amount.amount, {
          currency: terms.Amount.currency,
          issuer: terms.Amount.issuer,
          value: terms.Amount.value,
        });
  if (!sameParties || !sameAmount) {
    throw new PaymentError('this payment id already names different terms; it was not sent again');
  }
}

function isHoldReason(value: string): value is 'delivered-mismatch' | 'validated-after-expiry' {
  return value === 'delivered-mismatch' || value === 'validated-after-expiry';
}

/** The decision a settled journal record already states. */
function decisionOfRecord(record: JournalRecord): Decision {
  switch (record.state) {
    case 'paid':
      return {
        kind: 'paid',
        ledgerIndex: must(record.ledgerIndex, 'a paid record has no ledger index'),
      };
    case 'failed':
      return {
        kind: 'failed',
        engineResult: must(record.engineResult, 'a failed record has no engine result'),
        ledgerIndex: must(record.ledgerIndex, 'a failed record has no ledger index'),
      };
    case 'rejected':
      return {
        kind: 'rejected',
        engineResult: must(record.engineResult, 'a rejected record has no engine result'),
      };
    case 'held': {
      const reason = must(record.reason, 'a held record has no reason');
      if (!isHoldReason(reason)) {
        throw new PaymentError('a held record has an unknown reason');
      }
      return { kind: 'hold', reason };
    }
    default:
      throw new PaymentError(`the journal state ${record.state} is not settled`);
  }
}

/** The outcome a settled payment already has. It is reported without sending anything. */
function outcomeOfSettled(paymentId: string, view: PaymentView): TransferOutcome {
  return {
    paymentId,
    attempts: view.attempt,
    decision: decisionOfRecord(view.latest),
    hash: view.latest.hash ?? null,
  };
}

/** Rebuilds the plan of an unresolved attempt from its journal record, and checks it before it is resent. */
function planOfRecord(record: JournalRecord, transfer: Transfer, signers: Signers): SendPlan {
  const txBlob = must(
    record.txBlob,
    'the journal record has no signed transaction; inspect the journal',
  );
  const hash = must(record.hash, 'the journal record has no hash; inspect the journal');
  const lastLedgerSequence = must(
    record.lastLedgerSequence,
    'the journal record has no expiry; inspect the journal',
  );
  // Both values are public transaction data, not secrets, so a constant-time comparison is not needed here.
  // eslint-disable-next-line security/detect-possible-timing-attacks
  if (hashOfSigned(txBlob) !== hash) {
    throw new PaymentError(
      'the journal hash does not match its signed transaction; inspect the journal',
    );
  }
  assertSignedExactly(txBlob, [signers.agent.address, signers.warden.address]);
  assertSameTerms(txBlob, transfer);
  return {
    paymentId: transfer.paymentId,
    attempt: record.attempt,
    txBlob,
    hash,
    lastLedgerSequence,
    expected: expectedOf(transfer.amount),
  };
}

/**
 * Sends a two-signature transfer without ever sending the same obligation twice. The journal is read first.
 * A settled payment returns its recorded outcome. An unresolved attempt is resumed with its stored blob and
 * is never rebuilt. A new attempt follows only an expired one, and is numbered from the journal. Expired
 * attempts are replaced up to maxAttempts across all runs. Any other outcome, including 'wait', stops the loop.
 */
export async function sendTwoSignatureTransfer(
  deps: PaymentDeps,
  transfer: Transfer,
): Promise<TransferOutcome> {
  const prior = await priorAttemptOf(deps.journal, transfer.paymentId);
  if (prior.kind === 'settled') {
    assertSameTerms(
      must(prior.view.latest.txBlob, 'the settled record has no signed transaction'),
      transfer,
    );
    return outcomeOfSettled(transfer.paymentId, prior.view);
  }
  const signers = await loadSigners(deps);
  await assertSignerConfiguration(deps.port, transfer.from, signers);
  let attempt = firstAttemptOf(prior);
  let resume: SendPlan | undefined =
    prior.kind === 'unresolved' ? planOfRecord(prior.view.latest, transfer, signers) : undefined;
  let hash: string | null = prior.kind === 'expired' ? (prior.view.latest.hash ?? null) : null;
  while (attempt <= deps.maxAttempts) {
    const plan = resume ?? (await planTwoSignature(deps, transfer, signers, attempt));
    const decision =
      resume === undefined
        ? await sendAndReconcile(plan, deps)
        : await resumeAndReconcile(plan, deps);
    resume = undefined;
    hash = plan.hash;
    if (decision.kind !== 'expired') {
      return { paymentId: transfer.paymentId, attempts: attempt, decision, hash };
    }
    deps.log('payment_attempt_expired', { attempt });
    attempt += 1;
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
