/**
 * The states an invoice moves through, and the moves the code allows. A move that is not in this table cannot be
 * written to the log, so a bug cannot skip a check: the only path to a payment runs through every state in order.
 */

export const STATES = [
  'RECEIVED',
  'QUARANTINED',
  'EXTRACTED',
  'EVIDENCE_VERIFIED',
  'HELD',
  'WARDEN_ELIGIBLE',
  'SIGNED',
  'SUBMITTED',
  'VALIDATED',
  'RECONCILED',
  'FAILED',
  'RECONCILIATION_EXCEPTION',
] as const;

export type State = (typeof STATES)[number];

const NEXT: ReadonlyMap<State | null, readonly State[]> = new Map<State | null, readonly State[]>([
  [null, ['RECEIVED']],
  ['RECEIVED', ['QUARANTINED', 'EXTRACTED', 'HELD']],
  ['EXTRACTED', ['EVIDENCE_VERIFIED', 'HELD']],
  ['EVIDENCE_VERIFIED', ['WARDEN_ELIGIBLE', 'HELD']],
  ['WARDEN_ELIGIBLE', ['SIGNED', 'HELD', 'RECONCILIATION_EXCEPTION']],
  ['SIGNED', ['SUBMITTED', 'HELD', 'RECONCILIATION_EXCEPTION']],
  ['SUBMITTED', ['VALIDATED', 'FAILED', 'HELD', 'RECONCILIATION_EXCEPTION']],
  ['VALIDATED', ['RECONCILED', 'RECONCILIATION_EXCEPTION']],
  ['QUARANTINED', []],
  ['HELD', []],
  ['FAILED', []],
  ['RECONCILED', []],
  ['RECONCILIATION_EXCEPTION', []],
]);

/** The states in which a payment may have reached the ledger, or may still do so. A new payment is blocked by these. */
export const PAYMENT_BLOCKING: ReadonlySet<State> = new Set<State>([
  'SUBMITTED',
  'VALIDATED',
  'RECONCILED',
  'RECONCILIATION_EXCEPTION',
]);

export class TransitionError extends Error {
  constructor(from: State | null, to: State) {
    super(`a move from ${from ?? 'nothing'} to ${to} is not allowed`);
    this.name = 'TransitionError';
  }
}

export function assertTransition(from: State | null, to: State): void {
  const allowed = NEXT.get(from) ?? [];
  if (!allowed.includes(to)) {
    throw new TransitionError(from, to);
  }
}
