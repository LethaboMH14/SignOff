import { existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

import { type TransitionRecord } from '../../../agent/src/log/transition-log.js';
import { type InvoiceRecord, type ProposalRecord, WARDEN_STATUSES } from '../model/desk.js';
import { parseLines } from './transitions-tail.js';

/**
 * The shapes the console accepts from the Warden. Each schema lists only the fields the console uses. Zod drops every
 * other field on parse, so a new field added to a Warden view never reaches the browser by accident.
 */

const Limits = z.object({
  perPaymentMinor: z.number().int().nonnegative(),
  supplierDailyMinor: z.number().int().nonnegative(),
  dailyTotalMinor: z.number().int().nonnegative(),
});

export const OverviewView = z.object({
  paused: z.boolean(),
  policyVersion: z.string().min(1).max(40),
  limits: Limits,
  usageToday: z.object({
    day: z.string().min(1).max(20),
    totalMinor: z.number().int().nonnegative(),
  }),
  pendingLimitChange: z
    .object({
      requestId: z.string().min(1).max(80),
      requestedBy: z.string().min(1).max(64),
      requestedAt: z.string().min(1).max(40),
      expiresAt: z.string().min(1).max(40),
      perPaymentMinor: z.number().int().nonnegative(),
      supplierDailyMinor: z.number().int().nonnegative(),
      dailyTotalMinor: z.number().int().nonnegative(),
    })
    .nullable(),
});

export type OverviewView = z.infer<typeof OverviewView>;

const PaymentView = z.object({
  status: z.enum(WARDEN_STATUSES),
  supplierId: z.string().min(1).max(40),
  currency: z.string().min(1).max(10),
  amountMinor: z.number().int().nonnegative(),
  ledgerIndex: z.number().int().nonnegative().nullable(),
  engineResult: z.string().max(40).nullable(),
  transactionHash: z.string().max(64).nullable(),
});

export type PaymentView = z.infer<typeof PaymentView>;

export const ProposalView = z.object({
  attemptId: z.uuid(),
  decision: z.enum(['ALLOW', 'HOLD', 'REFUSE']),
  evaluatedAt: z.string().min(1).max(40),
  reasons: z.array(z.object({ code: z.string().min(1).max(40), message: z.string().max(300) })),
  payment: PaymentView.nullable(),
});

export type ProposalView = z.infer<typeof ProposalView>;

export const ProposalList = z.object({ proposals: z.array(ProposalView).max(5000) });

/** The Warden's proposal as the desk's rule takes it: the reason codes and the fields the rule reads. */
export function proposalRecordOf(view: ProposalView): ProposalRecord {
  return {
    attemptId: view.attemptId,
    decision: view.decision,
    reasonCodes: view.reasons.map((reason) => reason.code),
    evaluatedAt: view.evaluatedAt,
    payment:
      view.payment === null
        ? null
        : {
            status: view.payment.status,
            supplierId: view.payment.supplierId,
            currency: view.payment.currency,
            amountMinor: view.payment.amountMinor,
            ledgerIndex: view.payment.ledgerIndex,
            engineResult: view.payment.engineResult,
          },
  };
}

/**
 * The latest state of each invoice, from the agent's log. The log is append-only; the highest sequence number for an
 * invoice wins, and the latest attempt id that is set is kept, so the desk can join the invoice to its Warden attempt.
 */
export function latestInvoicesOf(records: readonly TransitionRecord[]): InvoiceRecord[] {
  const latest = new Map<string, { record: TransitionRecord; attemptId: string | null }>();
  for (const record of [...records].sort((a, b) => a.seq - b.seq)) {
    const earlier = latest.get(record.correlationId);
    const attemptId = record.attemptId ?? earlier?.attemptId ?? null;
    latest.set(record.correlationId, { record, attemptId });
  }
  return [...latest.values()].map(({ record, attemptId }) => ({
    correlationId: record.correlationId,
    attemptId,
    agentState: record.toState,
    reasonCode: record.reasonCode,
    at: record.at,
    modelCalls: record.evidence.modelCalls,
  }));
}

/**
 * The agent's transition log, read in full. A missing file is an empty history (the agent has not run yet). Damaged
 * lines are counted and skipped, never shown.
 */
export function readTransitions(path: string): {
  readonly records: readonly TransitionRecord[];
  readonly damaged: number;
} {
  // The path is the agent's log file, named by the operator at start-up; the console only reads it.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the agent's log, named at start-up
  if (!existsSync(path)) {
    return { records: [], damaged: 0 };
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the agent's log, named at start-up
  return parseLines(readFileSync(path, 'utf8'));
}
