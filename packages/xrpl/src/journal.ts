/**
 * The payment journal. Every attempt is written here before the network sees it, so a crash, a lost
 * response or a restart can always be reconciled by hash. Records hold signed transaction blobs (local
 * only, never logged) and no seeds.
 */

export const JOURNAL_STATES = [
  'prepared',
  'submitting',
  'submitted',
  'paid',
  'failed',
  'held',
  'expired',
  'rejected',
] as const;
export type JournalState = (typeof JOURNAL_STATES)[number];

export interface JournalRecord {
  readonly paymentId: string;
  /** 1 for the first attempt. A new attempt is only allowed after the previous one expired. */
  readonly attempt: number;
  readonly state: JournalState;
  readonly at: string;
  readonly hash?: string;
  readonly txBlob?: string;
  readonly lastLedgerSequence?: number;
  readonly engineResult?: string;
  readonly ledgerIndex?: number;
  readonly reason?: string;
}

export class JournalError extends Error {
  constructor(reason: string) {
    super(`Journal refused: ${reason}`);
    this.name = 'JournalError';
  }
}

const TRANSITIONS: ReadonlyMap<JournalState, readonly JournalState[]> = new Map<
  JournalState,
  readonly JournalState[]
>([
  ['prepared', ['submitting', 'rejected']],
  ['submitting', ['submitting', 'submitted', 'paid', 'failed', 'held', 'expired', 'rejected']],
  ['submitted', ['submitting', 'submitted', 'paid', 'failed', 'held', 'expired', 'rejected']],
]);

/** Checks one state change inside an attempt. `from` is undefined for the first record of an attempt. */
export function assertTransition(from: JournalState | undefined, to: JournalState): void {
  if (from === undefined) {
    if (to !== 'prepared') {
      throw new JournalError('an attempt must start with prepared');
    }
    return;
  }
  const allowed = TRANSITIONS.get(from) ?? [];
  if (!allowed.includes(to)) {
    throw new JournalError(`illegal transition ${from} to ${to}`);
  }
}

/** What the orchestrator should do next for a payment, given its journal. */
export type NextStep = 'submit' | 'reconcile' | 'new-attempt' | 'none';

export interface PaymentView {
  readonly paymentId: string;
  readonly attempt: number;
  readonly state: JournalState;
  readonly latest: JournalRecord;
  /** Number of submitting records in the current attempt. */
  readonly submissions: number;
}

/**
 * Replays a journal and checks every attempt's chain of states. Throws if the journal is inconsistent,
 * including a new attempt that starts before the previous one expired.
 */
export function replay(records: readonly JournalRecord[]): ReadonlyMap<string, PaymentView> {
  const byPayment = new Map<string, JournalRecord[]>();
  for (const record of records) {
    const list = byPayment.get(record.paymentId) ?? [];
    list.push(record);
    byPayment.set(record.paymentId, list);
  }
  const views = new Map<string, PaymentView>();
  for (const [paymentId, list] of byPayment) {
    let previous: JournalRecord | undefined;
    let submissions = 0;
    for (const record of list) {
      if (previous === undefined) {
        assertTransition(undefined, record.state);
        if (record.attempt !== 1) {
          throw new JournalError('the first record of a payment must be attempt 1');
        }
      } else if (record.attempt === previous.attempt) {
        assertTransition(previous.state, record.state);
      } else {
        if (record.attempt !== previous.attempt + 1 || previous.state !== 'expired') {
          throw new JournalError(
            'a new attempt is allowed only after the previous attempt expired',
          );
        }
        assertTransition(undefined, record.state);
      }
      if (record.attempt !== previous?.attempt) {
        submissions = 0;
      }
      if (record.state === 'submitting') {
        submissions += 1;
      }
      previous = record;
    }
    if (previous === undefined) {
      continue;
    }
    views.set(paymentId, {
      paymentId,
      attempt: previous.attempt,
      state: previous.state,
      latest: previous,
      submissions,
    });
  }
  return views;
}

/**
 * Decides the next step. A payment that was never sent is submitted as the same blob. A payment that
 * may have been sent is reconciled first. Only an expired attempt may be replaced by a new one.
 */
export function nextStep(view: PaymentView): NextStep {
  switch (view.state) {
    case 'prepared':
      return 'submit';
    case 'submitting':
    case 'submitted':
      return 'reconcile';
    case 'expired':
      return 'new-attempt';
    case 'paid':
    case 'failed':
    case 'held':
    case 'rejected':
      return 'none';
  }
}
