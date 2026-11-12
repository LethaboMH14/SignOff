import type { WardenDecision } from '../../../packages/shared/src/schemas/index.js';
import type { WardenEvent, PayeeRecord } from './events.js';

/** The rules that change at run time. Lowering a limit takes effect for the next proposal. */
export interface LimitsState {
  readonly revision: number;
  readonly policyVersion: string;
  readonly perPaymentMinor: number;
  readonly supplierDailyMinor: number;
  readonly dailyTotalMinor: number;
}

/** A raised limit that is waiting for a second operator. At most one is open at a time. */
export interface PendingLimitChange {
  readonly requestId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly perPaymentMinor: number;
  readonly supplierDailyMinor: number;
  readonly dailyTotalMinor: number;
}

export interface ChangeState {
  readonly changeId: string;
  readonly newPayee: PayeeRecord;
  readonly newPublicKey: string | null;
  readonly requestedAt: string;
  readonly status: 'requested' | 'confirmed' | 'approved';
  readonly confirmedBy: string | null;
  readonly approvedBy: string | null;
  readonly coolingOffUntil: string | null;
}

export interface SupplierState {
  readonly supplierId: string;
  readonly status: 'pending' | 'active';
  readonly payee: PayeeRecord;
  readonly publicKey: string;
  readonly enrolledBy: string;
  readonly approvedBy: string | null;
  readonly change: ChangeState | null;
}

export type AttemptStatus =
  'awaiting' | 'submitting' | 'held' | 'paid' | 'failed' | 'rejected' | 'expired';

export interface AttemptState {
  readonly attemptId: string;
  readonly scopedKey: string;
  readonly obligationKey: string;
  readonly invoiceFingerprint: string;
  readonly supplierId: string;
  readonly currency: string;
  readonly ledgerCurrency: string;
  readonly issuer: string;
  readonly amountMinor: number;
  readonly attemptNumber: number;
  readonly lastLedgerSequence: number;
  readonly txFields: string;
  readonly wardenBlob: string;
  readonly createdAt: string;
  readonly status: AttemptStatus;
  readonly finalBlob: string | null;
  readonly hash: string | null;
  readonly ledgerIndex: number | null;
  readonly engineResult: string | null;
}

export interface DecisionRecord {
  readonly fingerprint: string;
  readonly decision: WardenDecision;
}

/** An unresolved attempt holds its obligation. Paid attempts stay on record for the daily totals. */
export function isUnresolved(status: AttemptStatus): boolean {
  return status === 'awaiting' || status === 'submitting' || status === 'held';
}

/**
 * The Warden's in-memory view, built only by applying events in order. The service is its only writer,
 * and it writes under its own lock, so the view and the log never disagree.
 */
export class WardenState {
  limits: LimitsState;
  paused = false;
  /** Whether an operator has armed the watchdog. An armed Warden pauses itself when no heartbeat arrives in time. */
  armed = false;
  /** The raised limits waiting for a second operator, or null. Any applied change to the limits clears it. */
  pendingLimits: PendingLimitChange | null = null;
  readonly approvals = new Map<string, Set<string>>();
  readonly suppliers = new Map<string, SupplierState>();
  readonly attempts = new Map<string, AttemptState>();
  readonly decisions = new Map<string, DecisionRecord>();
  /** Nonces of payout change requests already accepted, so a captured request cannot be replayed. */
  readonly usedChangeNonces = new Set<string>();

  constructor(initialLimits: LimitsState) {
    this.limits = initialLimits;
  }

  /** Applies one event. An event that refers to something unknown means the log is damaged: throw. */
  apply(event: WardenEvent): void {
    switch (event.type) {
      case 'policy.limits':
        this.limits = {
          revision: this.limits.revision + 1,
          policyVersion: event.policyVersion,
          perPaymentMinor: event.perPaymentMinor,
          supplierDailyMinor: event.supplierDailyMinor,
          dailyTotalMinor: event.dailyTotalMinor,
        };
        return;
      case 'limits.requested':
        this.pendingLimits = {
          requestId: event.requestId,
          requestedBy: event.requestedBy,
          requestedAt: event.at,
          expiresAt: event.expiresAt,
          perPaymentMinor: event.perPaymentMinor,
          supplierDailyMinor: event.supplierDailyMinor,
          dailyTotalMinor: event.dailyTotalMinor,
        };
        return;
      case 'limits.approved':
        if (this.pendingLimits?.requestId !== event.requestId) {
          throw new Error('the event log refers to a limit change that is not pending');
        }
        this.limits = {
          revision: this.limits.revision + 1,
          policyVersion: event.policyVersion,
          perPaymentMinor: event.perPaymentMinor,
          supplierDailyMinor: event.supplierDailyMinor,
          dailyTotalMinor: event.dailyTotalMinor,
        };
        this.pendingLimits = null;
        return;
      case 'limits.expired':
        if (this.pendingLimits?.requestId !== event.requestId) {
          throw new Error('the event log refers to a limit change that is not pending');
        }
        this.pendingLimits = null;
        return;
      case 'watchdog.armed':
        this.armed = event.armed;
        return;
      case 'pause.set':
        this.paused = event.paused;
        return;
      case 'approval.recorded': {
        const approvers = this.approvals.get(event.fingerprint) ?? new Set<string>();
        approvers.add(event.operatorId);
        this.approvals.set(event.fingerprint, approvers);
        return;
      }
      case 'supplier.enrolled':
        this.suppliers.set(event.supplierId, {
          supplierId: event.supplierId,
          status: 'pending',
          payee: event.payee,
          publicKey: event.publicKey,
          enrolledBy: event.enrolledBy,
          approvedBy: null,
          change: null,
        });
        return;
      case 'supplier.approved': {
        const supplier = this.supplierOf(event.supplierId);
        this.suppliers.set(event.supplierId, {
          ...supplier,
          status: 'active',
          approvedBy: event.approvedBy,
        });
        return;
      }
      case 'change.requested': {
        const supplier = this.supplierOf(event.supplierId);
        this.usedChangeNonces.add(event.nonce);
        this.suppliers.set(event.supplierId, {
          ...supplier,
          change: {
            changeId: event.changeId,
            newPayee: event.newPayee,
            newPublicKey: event.newPublicKey,
            requestedAt: event.requestedAt,
            status: 'requested',
            confirmedBy: null,
            approvedBy: null,
            coolingOffUntil: null,
          },
        });
        return;
      }
      case 'change.confirmed': {
        const change = this.changeOf(event.supplierId, event.changeId);
        this.setChange(event.supplierId, {
          ...change,
          status: 'confirmed',
          confirmedBy: event.confirmedBy,
        });
        return;
      }
      case 'change.approved': {
        const change = this.changeOf(event.supplierId, event.changeId);
        this.setChange(event.supplierId, {
          ...change,
          status: 'approved',
          approvedBy: event.approvedBy,
          coolingOffUntil: event.coolingOffUntil,
        });
        return;
      }
      case 'change.applied': {
        const supplier = this.supplierOf(event.supplierId);
        const change = this.changeOf(event.supplierId, event.changeId);
        this.suppliers.set(event.supplierId, {
          ...supplier,
          payee: change.newPayee,
          publicKey: change.newPublicKey ?? supplier.publicKey,
          change: null,
        });
        return;
      }
      case 'decision.recorded':
        this.decisions.set(event.attemptId, {
          fingerprint: event.decision.proposalFingerprint,
          decision: event.decision,
        });
        return;
      case 'attempt.awaiting':
        this.attempts.set(event.attemptId, {
          attemptId: event.attemptId,
          scopedKey: event.scopedKey,
          obligationKey: event.obligationKey,
          invoiceFingerprint: event.invoiceFingerprint,
          supplierId: event.supplierId,
          currency: event.currency,
          ledgerCurrency: event.ledgerCurrency,
          issuer: event.issuer,
          amountMinor: event.amountMinor,
          attemptNumber: event.attemptNumber,
          lastLedgerSequence: event.lastLedgerSequence,
          txFields: event.txFields,
          wardenBlob: event.wardenBlob,
          createdAt: event.at,
          status: 'awaiting',
          finalBlob: null,
          hash: null,
          ledgerIndex: null,
          engineResult: null,
        });
        this.decisions.set(event.attemptId, {
          fingerprint: event.decision.proposalFingerprint,
          decision: event.decision,
        });
        return;
      case 'attempt.submitting':
        this.setAttempt(event.attemptId, {
          ...this.attemptOf(event.attemptId),
          status: 'submitting',
          finalBlob: event.finalBlob,
          hash: event.hash,
        });
        return;
      case 'attempt.settled':
        this.setAttempt(event.attemptId, {
          ...this.attemptOf(event.attemptId),
          status: event.status,
          ledgerIndex: event.ledgerIndex,
          engineResult: event.engineResult,
        });
        return;
    }
  }

  supplierOf(supplierId: string): SupplierState {
    const supplier = this.suppliers.get(supplierId);
    if (supplier === undefined) {
      throw new Error('the event log refers to a supplier that was never enrolled');
    }
    return supplier;
  }

  private changeOf(supplierId: string, changeId: string): ChangeState {
    const change = this.supplierOf(supplierId).change;
    if (change?.changeId !== changeId) {
      throw new Error('the event log refers to a payout change that is not pending');
    }
    return change;
  }

  private setChange(supplierId: string, change: ChangeState): void {
    this.suppliers.set(supplierId, { ...this.supplierOf(supplierId), change });
  }

  private attemptOf(attemptId: string): AttemptState {
    const attempt = this.attempts.get(attemptId);
    if (attempt === undefined) {
      throw new Error('the event log refers to a payment attempt that was never created');
    }
    return attempt;
  }

  private setAttempt(attemptId: string, attempt: AttemptState): void {
    this.attempts.set(attemptId, attempt);
  }
}
