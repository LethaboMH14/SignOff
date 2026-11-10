import type { SubmittableTransaction, Wallet } from 'xrpl';
import { hashOfSigned } from './multisig.js';
import { sendAndReconcile, type ReliableOptions, type SendPlan } from './reliable.js';
import type { Decision, Expected } from './reconcile.js';

/** Everything a ledger step needs: the port, the journal, the clock and the polling policy. */
export interface LedgerDeps extends ReliableOptions {
  readonly newId: () => string;
}

/** Structured progress events. Values are codes and counts, never addresses or seeds. */
export type LogFn = (
  event: string,
  fields?: Readonly<Record<string, string | number | boolean>>,
) => void;

export class LedgerStepError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LedgerStepError';
  }
}

/** A short description of a decision for error messages. Contains no account identifiers. */
export function describeDecision(decision: Decision): string {
  switch (decision.kind) {
    case 'paid':
      return `validated in ledger ${String(decision.ledgerIndex)}`;
    case 'failed':
      return `validated with ${decision.engineResult}`;
    case 'hold':
      return `held (${decision.reason})`;
    case 'expired':
      return 'expired before validation';
    case 'rejected':
      return `rejected (${decision.engineResult})`;
    case 'wait':
      return 'not decided within the poll budget';
  }
}

/**
 * Autofills a transaction and signs it with the given wallet, producing a plan ready for the reliable
 * path. The payment id is unique per call, so repeated runs never share journal records.
 */
export async function signedPlan(
  deps: LedgerDeps,
  wallet: Wallet,
  transaction: SubmittableTransaction,
  label: string,
  expected: Expected = { kind: 'none' },
): Promise<SendPlan> {
  const prepared = await deps.port.autofill(transaction, 0);
  const lastLedgerSequence = prepared.LastLedgerSequence;
  if (lastLedgerSequence === undefined) {
    throw new LedgerStepError('autofill did not set LastLedgerSequence');
  }
  const txBlob = wallet.sign(prepared).tx_blob;
  return {
    paymentId: `${label}.${deps.newId()}`,
    attempt: 1,
    txBlob,
    hash: hashOfSigned(txBlob),
    lastLedgerSequence,
    expected,
  };
}

/** Signs one transaction with a single key and sends it through the reliable path. */
export async function sendSingleSigned(
  deps: LedgerDeps,
  wallet: Wallet,
  transaction: SubmittableTransaction,
  label: string,
  expected: Expected = { kind: 'none' },
): Promise<Decision> {
  return sendAndReconcile(await signedPlan(deps, wallet, transaction, label, expected), deps);
}
