import { dailyUsage, sastDay } from './checks.js';
import type {
  AttemptState,
  AttemptStatus,
  PendingLimitChange,
  SupplierState,
  WardenState,
} from './state.js';

/**
 * The read model for the operator console. Every view is built field by field from the state and lists only what the
 * console shows. Signed transactions, transaction fields, the scoped key and the invoice fingerprint never appear in a
 * view, so a read cannot leak signing material or invoice identifiers. Reading changes nothing.
 */

export type DecisionKind = 'ALLOW' | 'HOLD' | 'REFUSE';

export interface OpsOverview {
  readonly paused: boolean;
  readonly policyVersion: string;
  readonly limits: {
    readonly perPaymentMinor: number;
    readonly supplierDailyMinor: number;
    readonly dailyTotalMinor: number;
  };
  readonly usageToday: { readonly day: string; readonly totalMinor: number };
  readonly pendingLimitChange: OpsPendingLimitChange | null;
}

/** A raised limit waiting for a second operator. */
export interface OpsPendingLimitChange {
  readonly requestId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly perPaymentMinor: number;
  readonly supplierDailyMinor: number;
  readonly dailyTotalMinor: number;
}

export interface OpsReason {
  readonly code: string;
  readonly message: string;
}

/** The payment attempt behind a proposal. A proposal that was held or refused has none. */
export interface OpsPayment {
  readonly status: AttemptStatus;
  readonly attemptNumber: number;
  readonly obligationKey: string;
  readonly supplierId: string;
  readonly currency: string;
  readonly ledgerCurrency: string;
  readonly amountMinor: number;
  readonly createdAt: string;
  readonly ledgerIndex: number | null;
  readonly engineResult: string | null;
  readonly transactionHash: string | null;
}

export interface OpsProposal {
  readonly attemptId: string;
  readonly decision: DecisionKind;
  readonly policyVersion: string;
  readonly evaluatedAt: string;
  readonly reasons: readonly OpsReason[];
  readonly payment: OpsPayment | null;
}

export interface OpsSupplier {
  readonly supplierId: string;
  readonly status: 'pending' | 'active';
  readonly payee: { readonly address: string; readonly destinationTag: number | null };
  readonly enrolledBy: string;
  readonly approvedBy: string | null;
  readonly change: {
    readonly changeId: string;
    readonly status: 'requested' | 'confirmed' | 'approved';
    readonly requestedAt: string;
    readonly coolingOffUntil: string | null;
  } | null;
}

function pendingViewOf(pending: PendingLimitChange | null): OpsPendingLimitChange | null {
  if (pending === null) {
    return null;
  }
  return {
    requestId: pending.requestId,
    requestedBy: pending.requestedBy,
    requestedAt: pending.requestedAt,
    expiresAt: pending.expiresAt,
    perPaymentMinor: pending.perPaymentMinor,
    supplierDailyMinor: pending.supplierDailyMinor,
    dailyTotalMinor: pending.dailyTotalMinor,
  };
}

export function overviewOf(state: WardenState, now: Date): OpsOverview {
  const day = sastDay(now);
  return {
    paused: state.paused,
    policyVersion: state.limits.policyVersion,
    limits: {
      perPaymentMinor: state.limits.perPaymentMinor,
      supplierDailyMinor: state.limits.supplierDailyMinor,
      dailyTotalMinor: state.limits.dailyTotalMinor,
    },
    usageToday: { day, totalMinor: dailyUsage(state.attempts.values(), day, null) },
    pendingLimitChange: pendingViewOf(state.pendingLimits),
  };
}

function paymentViewOf(attempt: AttemptState): OpsPayment {
  return {
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    obligationKey: attempt.obligationKey,
    supplierId: attempt.supplierId,
    currency: attempt.currency,
    ledgerCurrency: attempt.ledgerCurrency,
    amountMinor: attempt.amountMinor,
    createdAt: attempt.createdAt,
    ledgerIndex: attempt.ledgerIndex,
    engineResult: attempt.engineResult,
    transactionHash: attempt.hash,
  };
}

/** One proposal by its attempt id, or undefined when the Warden has recorded no decision for that id. */
export function proposalViewOf(state: WardenState, attemptId: string): OpsProposal | undefined {
  const record = state.decisions.get(attemptId);
  if (record === undefined) {
    return undefined;
  }
  const attempt = state.attempts.get(attemptId);
  return {
    attemptId,
    decision: record.decision.decision,
    policyVersion: record.decision.policyVersion,
    evaluatedAt: record.decision.evaluatedAt,
    reasons: record.decision.reasons.map((reason) => ({
      code: reason.code,
      message: reason.message,
    })),
    payment: attempt === undefined ? null : paymentViewOf(attempt),
  };
}

/** Every recorded decision, newest first. Held and refused proposals appear here as well as payments. */
export function proposalsOf(state: WardenState): OpsProposal[] {
  const views: OpsProposal[] = [];
  for (const attemptId of state.decisions.keys()) {
    const view = proposalViewOf(state, attemptId);
    if (view !== undefined) {
      views.push(view);
    }
  }
  return views.sort(
    (a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt) || a.attemptId.localeCompare(b.attemptId),
  );
}

function supplierViewOf(supplier: SupplierState): OpsSupplier {
  const change = supplier.change;
  return {
    supplierId: supplier.supplierId,
    status: supplier.status,
    payee: { address: supplier.payee.address, destinationTag: supplier.payee.destinationTag },
    enrolledBy: supplier.enrolledBy,
    approvedBy: supplier.approvedBy,
    change:
      change === null
        ? null
        : {
            changeId: change.changeId,
            status: change.status,
            requestedAt: change.requestedAt,
            coolingOffUntil: change.coolingOffUntil,
          },
  };
}

/** Every enrolled supplier, by supplier id. The public key is left out: it is not needed to read the state. */
export function suppliersOf(state: WardenState): OpsSupplier[] {
  return [...state.suppliers.values()]
    .map(supplierViewOf)
    .sort((a, b) => a.supplierId.localeCompare(b.supplierId));
}
