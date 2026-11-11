import { combineSigned, hashOfSigned, signAsSigner } from './multisig.js';
import { walletOf } from './provision.js';
import { desiredSignerList } from './signers.js';
import { sendAndReconcile, type SendPlan } from './reliable.js';
import type { Decision } from './reconcile.js';
import { buildSignerListSet } from './transactions.js';
import {
  assertSignerConfiguration,
  deliveredBalance,
  expectedOf,
  loadSigners,
  PaymentError,
  sameBalance,
  transactionOf,
  type PaymentDeps,
  type Transfer,
} from './payments.js';

export type Signer = 'agent' | 'warden';

export interface Refusal {
  readonly signer: Signer;
  readonly what: 'payment' | 'signer-list-change';
  readonly outcome: string;
}

export interface RejectionReport {
  readonly refusals: readonly Refusal[];
  /** True when the recipient's balance did not move during any refused attempt. */
  readonly recipientUnchanged: boolean;
}

/** The engine result when a transaction was refused, or a description of what happened instead. */
function outcomeOf(decision: Decision): string {
  return decision.kind === 'rejected' ? decision.engineResult : `not-rejected (${decision.kind})`;
}

/**
 * Shows that no single key can move money or change the signers. Each key signs the same payment alone,
 * and then a signer-list change alone; the ledger must refuse every one, and the recipient's balance must
 * be unchanged afterwards. Nothing is retried: a refused transaction cannot apply later.
 */
export async function demonstrateRejections(
  deps: PaymentDeps,
  transfer: Transfer,
): Promise<RejectionReport> {
  const signers = await loadSigners(deps);
  await assertSignerConfiguration(deps.port, transfer.from, signers);
  const before = await deliveredBalance(deps.port, transfer.to, transfer.amount);
  const refusals: Refusal[] = [];
  const desired = desiredSignerList(signers.agent, signers.warden);

  for (const signer of ['agent', 'warden'] as const) {
    const account = signer === 'agent' ? signers.agent : signers.warden;
    const prepared = await deps.port.autofill(transactionOf(transfer), 1);
    const lastLedgerSequence = prepared.LastLedgerSequence;
    if (lastLedgerSequence === undefined) {
      throw new PaymentError('autofill did not set LastLedgerSequence');
    }
    const txBlob = combineSigned([signAsSigner(walletOf(account), prepared)]);
    const plan: SendPlan = {
      paymentId: `${transfer.paymentId}.single.${signer}`,
      attempt: 1,
      txBlob,
      hash: hashOfSigned(txBlob),
      lastLedgerSequence,
      expected: expectedOf(transfer.amount),
    };
    refusals.push({
      signer,
      what: 'payment',
      outcome: outcomeOf(await sendAndReconcile(plan, deps)),
    });
  }

  for (const signer of ['agent', 'warden'] as const) {
    const account = signer === 'agent' ? signers.agent : signers.warden;
    const listChange = buildSignerListSet(transfer.from.address, desired.quorum, desired.entries);
    const prepared = await deps.port.autofill(listChange, 1);
    const lastLedgerSequence = prepared.LastLedgerSequence;
    if (lastLedgerSequence === undefined) {
      throw new PaymentError('autofill did not set LastLedgerSequence');
    }
    const txBlob = combineSigned([signAsSigner(walletOf(account), prepared)]);
    const plan: SendPlan = {
      paymentId: `${transfer.paymentId}.change.${signer}`,
      attempt: 1,
      txBlob,
      hash: hashOfSigned(txBlob),
      lastLedgerSequence,
      expected: { kind: 'none' },
    };
    refusals.push({
      signer,
      what: 'signer-list-change',
      outcome: outcomeOf(await sendAndReconcile(plan, deps)),
    });
  }

  const after = await deliveredBalance(deps.port, transfer.to, transfer.amount);
  return { refusals, recipientUnchanged: sameBalance(before, after) };
}
