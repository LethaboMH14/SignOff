/**
 * The payment evidence path: invoice, checks, policy, payout destination, settlement. It shows where the agent got to.
 * A changed payout destination stops the path there, and settlement is then not reached. Nothing here decides a payment;
 * it only reads what the console already holds for the invoice.
 */

import type { DisplayState } from './desk.js';

export type StageOutcome = 'done' | 'stopped' | 'not-reached';

export interface EvidenceStage {
  readonly id: 'invoice' | 'checks' | 'policy' | 'payout' | 'settlement';
  readonly label: string;
  readonly outcome: StageOutcome;
  /** One plain sentence on what this stage found. */
  readonly detail: string;
}

/** The fields of an invoice the path reads. A subset of the console's invoice detail, so tests need no server. */
export interface EvidencePathInput {
  readonly displayState: DisplayState;
  readonly supplierId: string | null;
  readonly failedRule: { readonly code: string; readonly sentence: string } | null;
  readonly wardenDecision: {
    readonly decision: 'ALLOW' | 'HOLD' | 'REFUSE';
    readonly policyVersion: string;
  } | null;
  readonly payoutChange: {
    readonly status: 'none' | 'requested' | 'confirmed' | 'approved';
    readonly why: string;
  } | null;
}

/** The reason a payout destination stopped the path, in plain words. */
function changedWhy(change: EvidencePathInput['payoutChange']): string {
  return change === null
    ? 'The payout destination changed. Nothing moves until a person confirms it.'
    : change.why;
}

/**
 * The five stages in order. The path stops at the first stage that is not done. Settlement is "done" only when the desk
 * shows Paid, which the desk does only after the ledger has validated the payment, and no payout change is pending.
 */
export function evidenceStagesOf(input: EvidencePathInput): readonly EvidenceStage[] {
  const checksFailed = input.failedRule !== null;
  const payoutChanged = input.payoutChange !== null && input.payoutChange.status !== 'none';
  const decision = input.wardenDecision?.decision ?? null;
  const policyPassed = !checksFailed && decision === 'ALLOW';

  const invoiceStage: EvidenceStage = {
    id: 'invoice',
    label: 'Invoice read',
    outcome: 'done',
    detail:
      input.supplierId === null
        ? 'Read, and not yet matched to a supplier.'
        : 'Read, and matched to a verified supplier record.',
  };
  const checksStage: EvidenceStage = {
    id: 'checks',
    label: 'Checks against records',
    outcome: checksFailed ? 'stopped' : 'done',
    detail:
      input.failedRule === null
        ? 'Every check passed.'
        : `${input.failedRule.code}: ${input.failedRule.sentence}`,
  };
  const policyStage: EvidenceStage = {
    id: 'policy',
    label: 'Policy decision',
    outcome:
      checksFailed || decision === null ? 'not-reached' : decision === 'ALLOW' ? 'done' : 'stopped',
    detail: checksFailed
      ? 'Not reached: a check failed first.'
      : decision === null
        ? 'The Warden has not decided yet.'
        : decision === 'ALLOW'
          ? `Passed under rules ${input.wardenDecision?.policyVersion ?? ''}.`
          : `${decision} under rules ${input.wardenDecision?.policyVersion ?? ''}.`,
  };
  const payoutStage: EvidenceStage = {
    id: 'payout',
    label: 'Payout destination',
    outcome: !policyPassed ? 'not-reached' : payoutChanged ? 'stopped' : 'done',
    detail: !policyPassed
      ? 'Not checked yet.'
      : payoutChanged
        ? changedWhy(input.payoutChange)
        : 'The enrolled account is unchanged.',
  };
  const settled = input.displayState === 'Paid' && !payoutChanged;
  const settlementStage: EvidenceStage = {
    id: 'settlement',
    label: 'Settlement on the ledger',
    outcome: settled ? 'done' : 'not-reached',
    detail: settled
      ? 'Validated on the ledger and reconciled.'
      : payoutChanged
        ? 'Not reached. The path stopped at the payout destination.'
        : 'Not reached. Paid appears only after the ledger validates the payment.',
  };
  return [invoiceStage, checksStage, policyStage, payoutStage, settlementStage];
}

/** Where the path stopped: the first stage that is not done, or null when the path ran to settlement. */
export function stopOf(stages: readonly EvidenceStage[]): EvidenceStage | null {
  return stages.find((stage) => stage.outcome !== 'done') ?? null;
}
