import { classifySubmitResult } from './results.js';
import { decide, type Decision, type Expected } from './reconcile.js';
import { JournalError, replay, type JournalRecord, type JournalState } from './journal.js';
import type { LedgerPort } from './port.js';

/**
 * Where journal records go and where they are read back from. The node implementation appends to a file
 * and flushes it to disk.
 */
export interface JournalSink {
  append(record: JournalRecord): Promise<void>;
  readAll(): Promise<JournalRecord[]>;
}

/** One signed attempt to be sent and reconciled. */
export interface SendPlan {
  readonly paymentId: string;
  readonly attempt: number;
  readonly txBlob: string;
  readonly hash: string;
  readonly lastLedgerSequence: number;
  readonly expected: Expected;
}

export interface ReliableOptions {
  readonly port: LedgerPort;
  readonly journal: JournalSink;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollMs: number;
  /** A bound on the wait, so a stuck endpoint cannot hang the process. Ledgers close about every 4 s. */
  readonly maxPolls: number;
}

interface RecordExtra {
  readonly engineResult?: string;
  readonly ledgerIndex?: number;
  readonly reason?: string;
}

function record(plan: SendPlan, state: JournalState, now: Date, extra: RecordExtra): JournalRecord {
  return {
    paymentId: plan.paymentId,
    attempt: plan.attempt,
    state,
    at: now.toISOString(),
    hash: plan.hash,
    txBlob: plan.txBlob,
    lastLedgerSequence: plan.lastLedgerSequence,
    ...(extra.engineResult === undefined ? {} : { engineResult: extra.engineResult }),
    ...(extra.ledgerIndex === undefined ? {} : { ledgerIndex: extra.ledgerIndex }),
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
  };
}

/** A submit result that leaves the transaction pending: it was relayed, queued or applied with a failure. */
function isPending(engineResult: string): boolean {
  const submitClass = classifySubmitResult(engineResult);
  return submitClass === 'accepted' || submitClass === 'applied-failure';
}

/**
 * The journal decides before anything is sent. A payment id with no record may start attempt 1. One whose
 * latest attempt expired may start the next attempt number. Anything else is refused: an unresolved attempt
 * is resumed with its stored blob, and a settled payment is never sent again.
 */
async function assertMayPrepare(journal: JournalSink, plan: SendPlan): Promise<void> {
  const view = replay(await journal.readAll()).get(plan.paymentId);
  if (view === undefined) {
    if (plan.attempt !== 1) {
      throw new JournalError(
        `payment ${plan.paymentId} has no earlier attempt; attempt 1 must come first`,
      );
    }
    return;
  }
  if (view.state !== 'expired' || plan.attempt !== view.attempt + 1) {
    throw new JournalError(
      `payment ${plan.paymentId} is ${view.state} at attempt ${String(view.attempt)}; it is not sent again`,
    );
  }
}

/**
 * Sends a signed attempt and waits for its outcome. The journal is written before the network is
 * touched. A submission that throws or is deferred is never treated as a failure: the hash is
 * reconciled against validated ledgers, and an identical blob is resent (same hash, so it cannot apply
 * twice). The function returns 'wait' only when the poll budget runs out; the journal then still holds
 * an open state, and a later run continues from it.
 */
export async function sendAndReconcile(
  plan: SendPlan,
  options: ReliableOptions,
): Promise<Decision> {
  const { port, journal, now } = options;
  await assertMayPrepare(journal, plan);
  await journal.append(record(plan, 'prepared', now(), {}));
  await journal.append(record(plan, 'submitting', now(), { reason: 'send' }));
  let pending = false;
  try {
    const outcome = await port.submit(plan.txBlob);
    // A stale sequence or an "already present" result can describe a transaction
    // the ledger validated earlier. Never declare it rejected from the submit reply
    // alone: reconcile the original hash against validated history first.
    const mightAlreadyExist =
      outcome.engineResult === 'tefPAST_SEQ' || outcome.engineResult === 'tefALREADY';
    if (classifySubmitResult(outcome.engineResult) === 'rejected' && !mightAlreadyExist) {
      await journal.append(record(plan, 'rejected', now(), { engineResult: outcome.engineResult }));
      return { kind: 'rejected', engineResult: outcome.engineResult };
    }
    pending = isPending(outcome.engineResult);
    await journal.append(record(plan, 'submitted', now(), { engineResult: outcome.engineResult }));
  } catch {
    await journal.append(record(plan, 'submitted', now(), { reason: 'no-response' }));
  }
  return reconcile(plan, options, pending);
}

/**
 * Continues a plan whose earlier outcome is unknown: after a failover, or after a restart. The identical
 * blob is resent if needed. The transaction is never rebuilt, so it cannot apply twice.
 */
export function resumeAndReconcile(plan: SendPlan, options: ReliableOptions): Promise<Decision> {
  return reconcile(plan, options, false);
}

async function reconcile(
  plan: SendPlan,
  options: ReliableOptions,
  initiallyPending: boolean,
): Promise<Decision> {
  const { port, journal, now, sleep, pollMs, maxPolls } = options;
  let pending = initiallyPending;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    // The validated index is read first. Every ledger up to it is final, so the lookup that follows reflects
    // them. Reading it after the lookup would allow an expiry that the lookup never checked.
    const lastValidatedLedger = await port.validatedLedgerIndex();
    const lookup = await port.lookup(plan.hash);
    const decision = decide({
      expected: plan.expected,
      lookup,
      lastValidatedLedger,
      lastLedgerSequence: plan.lastLedgerSequence,
    });
    if (decision.kind !== 'wait') {
      return finish(plan, decision, now, journal);
    }
    if (!pending || poll % 4 === 3) {
      await journal.append(record(plan, 'submitting', now(), { reason: 'resend-same-blob' }));
      try {
        const outcome = await port.submit(plan.txBlob);
        pending = isPending(outcome.engineResult);
        await journal.append(
          record(plan, 'submitted', now(), { engineResult: outcome.engineResult }),
        );
      } catch {
        pending = false;
        await journal.append(record(plan, 'submitted', now(), { reason: 'no-response' }));
      }
    }
    await sleep(pollMs);
  }
  return { kind: 'wait' };
}

/** Writes the terminal journal record for a decision and returns the decision. */
async function finish(
  plan: SendPlan,
  decision: Exclude<Decision, { kind: 'wait' }>,
  now: () => Date,
  journal: JournalSink,
): Promise<Decision> {
  switch (decision.kind) {
    case 'paid':
      await journal.append(
        record(plan, 'paid', now(), {
          engineResult: 'tesSUCCESS',
          ledgerIndex: decision.ledgerIndex,
        }),
      );
      break;
    case 'failed':
      await journal.append(
        record(plan, 'failed', now(), {
          engineResult: decision.engineResult,
          ledgerIndex: decision.ledgerIndex,
        }),
      );
      break;
    case 'hold':
      await journal.append(record(plan, 'held', now(), { reason: decision.reason }));
      break;
    case 'expired':
      await journal.append(
        record(plan, 'expired', now(), { reason: 'last-ledger-sequence-passed' }),
      );
      break;
    case 'rejected':
      await journal.append(
        record(plan, 'rejected', now(), { engineResult: decision.engineResult }),
      );
      break;
  }
  return decision;
}
