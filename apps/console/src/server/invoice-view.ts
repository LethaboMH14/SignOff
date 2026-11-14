import { selectRecords } from '../../../agent/src/audit/export.js';
import { type TransitionRecord } from '../../../agent/src/log/transition-log.js';
import { type DisplayState, deskRowsOf } from '../model/desk.js';
import { maskAccount, nextActionOf } from '../model/next-action.js';
import { reasonTextOf } from '../model/reasons.js';
import { ACTOR_LABELS, STATE_LABELS } from '../model/states.js';
import {
  latestInvoicesOf,
  type ProposalView,
  proposalRecordOf,
  type SupplierView,
} from './warden-reads.js';

/**
 * The held-invoice view. The evidence path is the agent's audit selection for the same obligation (the same function the
 * export uses), so the two agree move for move. Document text is never included: a move carries its reason code, its
 * reason words from the catalogue, and the SHA-256 hashes of the file and records it used.
 */

const ACTOR_NAMES: ReadonlyMap<string, string> = new Map<string, string>(
  Object.entries(ACTOR_LABELS),
);
const STATE_NAMES: ReadonlyMap<string, string> = new Map<string, string>(
  Object.entries(STATE_LABELS),
);

export interface PayoutChangeView {
  readonly status: 'none' | 'requested' | 'confirmed' | 'approved';
  readonly coolingOffUntil: string | null;
  /** The console does not approve payout changes in this version, so the approval control is always disabled. */
  readonly approvalAllowed: false;
  /** Why the control is disabled, in plain words. */
  readonly why: string;
}

export interface MoveView {
  readonly seq: number;
  readonly at: string;
  readonly actorLabel: string;
  readonly stateLabel: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly policyVersion: string;
  readonly fileSha256: string | null;
  readonly recordSha256s: readonly string[];
}

export interface InvoiceDetail {
  readonly invoiceRef: string;
  readonly attemptId: string | null;
  readonly displayState: DisplayState;
  readonly supplierId: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly failedRule: { readonly code: string; readonly sentence: string } | null;
  readonly nextAction: string | null;
  /** The enrolled account, masked to its last four characters. */
  readonly enrolledPayee: string | null;
  readonly payoutChange: PayoutChangeView | null;
  readonly wardenDecision: {
    readonly decision: 'ALLOW' | 'HOLD' | 'REFUSE';
    readonly policyVersion: string;
    readonly evaluatedAt: string;
    readonly reasonCodes: readonly string[];
  } | null;
  readonly history: readonly MoveView[];
}

function payoutChangeOf(supplier: SupplierView | null): PayoutChangeView | null {
  if (supplier === null) {
    return null;
  }
  const change = supplier.change;
  if (change === null) {
    return {
      status: 'none',
      coolingOffUntil: null,
      approvalAllowed: false,
      why: 'No payout change is pending for this supplier.',
    };
  }
  return {
    status: change.status,
    coolingOffUntil: change.coolingOffUntil,
    approvalAllowed: false,
    why:
      change.status === 'approved'
        ? 'The payout change is approved and waits out its cooling-off period. The console does not apply it.'
        : 'A payout change is approved by a second operator in the Warden, once it is confirmed and its cooling-off period has ended. The console does not approve payout changes.',
  };
}

function moveOf(record: TransitionRecord): MoveView {
  return {
    seq: record.seq,
    at: record.at,
    actorLabel: ACTOR_NAMES.get(record.actor) ?? record.actor,
    stateLabel: STATE_NAMES.get(record.toState) ?? record.toState,
    reasonCode: record.reasonCode,
    reason: reasonTextOf(record.reasonCode),
    policyVersion: record.policyVersion,
    fileSha256: record.evidence.fileSha256,
    recordSha256s: record.evidence.recordSha256s,
  };
}

/** The detail for one invoice, or null when the agent's log has no record of it. */
export function invoiceDetailOf(input: {
  readonly records: readonly TransitionRecord[];
  readonly correlationId: string;
  readonly proposal: ProposalView | null;
  readonly supplier: SupplierView | null;
}): InvoiceDetail | null {
  const latest = latestInvoicesOf(input.records).find(
    (invoice) => invoice.correlationId === input.correlationId,
  );
  if (latest === undefined) {
    return null;
  }
  const proposal =
    input.proposal !== null && input.proposal.attemptId === latest.attemptId
      ? input.proposal
      : null;
  const row = deskRowsOf([latest], proposal === null ? [] : [proposalRecordOf(proposal)])[0];
  if (row === undefined) {
    return null;
  }
  const obligationKey = input.records
    .filter((record) => record.correlationId === input.correlationId)
    .reduce<string | null>((found, record) => record.obligationKey ?? found, null);
  const path = selectRecords(
    input.records,
    obligationKey === null
      ? { obligationKey: null, correlationId: input.correlationId }
      : { obligationKey, correlationId: null },
  );
  const code = row.reasonCode;
  const failedRule =
    row.displayState !== 'Paid' && code !== null && code !== 'OK'
      ? { code, sentence: reasonTextOf(code) }
      : null;
  return {
    invoiceRef: row.invoiceRef,
    attemptId: row.attemptId,
    displayState: row.displayState,
    supplierId: row.supplierId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    failedRule,
    nextAction: failedRule === null ? null : nextActionOf(failedRule.code),
    enrolledPayee: maskAccount(input.supplier?.payee.address ?? null),
    payoutChange: payoutChangeOf(input.supplier),
    wardenDecision:
      proposal === null
        ? null
        : {
            decision: proposal.decision,
            policyVersion: proposal.policyVersion,
            evaluatedAt: proposal.evaluatedAt,
            reasonCodes: proposal.reasons.map((reason) => reason.code),
          },
    history: path.map(moveOf),
  };
}
