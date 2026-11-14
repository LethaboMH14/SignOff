import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import {
  PolicyVersion,
  Sha256Hex,
  IsoInstant,
} from '../../../../packages/shared/src/schemas/primitives.js';
import { assertTransition, PAYMENT_BLOCKING, STATES, type State } from '../workflow/states.js';

/**
 * The agent's decision log. Every state change is one line, written and flushed before the next step runs, so a
 * restart cannot forget a payment that reached the Warden. Each line names the actor, the reason, the policy version
 * and the hashes of the evidence used. It never holds document text, personal data or keys.
 */

export const ACTORS = [
  'intake',
  'screen',
  'extractor',
  'verifier',
  'matcher',
  'warden',
  'signer',
  'submitter',
  'reconciler',
] as const;

export type Actor = (typeof ACTORS)[number];

const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);

export const Evidence = z.strictObject({
  /** SHA-256 of the invoice file's bytes, when the file was read. */
  fileSha256: Sha256Hex.nullable(),
  /** SHA-256 of each buyer record used: the invoice, purchase order and goods receipt. */
  recordSha256s: z.array(Sha256Hex).max(10),
  /** SHA-256 of each normalised quote behind a verified field. The quoted text itself is not logged. */
  quoteSha256s: z.array(Sha256Hex).max(20),
  model: z.string().min(1).max(200).nullable(),
  modelCalls: z.int().min(0).max(3),
  screenCodes: z.array(z.string().min(1).max(40)).max(10),
});
export type Evidence = z.infer<typeof Evidence>;

export const TransitionRecord = z.strictObject({
  seq: z.int().min(1),
  at: IsoInstant,
  correlationId: Sha256Hex,
  obligationKey: Sha256Hex.nullable(),
  fromState: z.enum(STATES).nullable(),
  toState: z.enum(STATES),
  actor: z.enum(ACTORS),
  reasonCode: ReasonCode,
  reasons: z.array(z.string().min(1).max(120)).max(20),
  policyVersion: PolicyVersion,
  attemptId: z.uuid().nullable(),
  ledgerHash: z
    .string()
    .regex(/^[0-9A-F]{64}$/)
    .nullable(),
  evidence: Evidence,
});
export type TransitionRecord = z.infer<typeof TransitionRecord>;

/** What a caller supplies. The log adds the sequence number, the time and the state it moved from. */
export interface NewTransition {
  readonly correlationId: string;
  readonly obligationKey: string | null;
  readonly toState: State;
  readonly actor: Actor;
  readonly reasonCode: string;
  readonly reasons: readonly string[];
  readonly policyVersion: string;
  readonly attemptId: string | null;
  readonly ledgerHash: string | null;
  readonly evidence: Evidence;
}

export class TransitionLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionLogError';
  }
}

export class TransitionLog {
  private readonly lines: TransitionRecord[] = [];
  private readonly lastState = new Map<string, State>();

  private constructor(
    private readonly path: string | null,
    private readonly now: () => Date,
  ) {}

  /**
   * Opens a log. With a path, existing lines are read and checked first, so a damaged or out-of-order log stops the
   * agent instead of being built on. With no path, the log lives in memory (evaluation runs).
   */
  static open(path: string | null, now: () => Date): TransitionLog {
    const log = new TransitionLog(path, now);
    if (path === null) {
      return log;
    }
    const text = readTextOrEmpty(path);
    text.split('\n').forEach((line, index) => {
      if (line.trim().length === 0) {
        return;
      }
      log.replay(line, index + 1);
    });
    return log;
  }

  private replay(line: string, lineNumber: number): void {
    let json: unknown;
    try {
      json = JSON.parse(line) as unknown;
    } catch {
      throw new TransitionLogError(`the transition log is damaged at line ${String(lineNumber)}`);
    }
    const parsed = TransitionRecord.safeParse(json);
    if (!parsed.success) {
      throw new TransitionLogError(`the transition log is damaged at line ${String(lineNumber)}`);
    }
    const record = parsed.data;
    const expectedSeq = this.lines.length + 1;
    const previous = this.lastState.get(record.correlationId) ?? null;
    if (record.seq !== expectedSeq || record.fromState !== previous) {
      throw new TransitionLogError(
        `the transition log is out of order at line ${String(lineNumber)}`,
      );
    }
    try {
      assertTransition(previous, record.toState);
    } catch {
      throw new TransitionLogError(
        `the transition log has a move that is not allowed at line ${String(lineNumber)}`,
      );
    }
    this.remember(record);
  }

  private remember(record: TransitionRecord): void {
    this.lines.push(record);
    this.lastState.set(record.correlationId, record.toState);
  }

  /** Writes one transition. It is durable before this returns, and the state changes only after the write succeeds. */
  append(input: NewTransition): TransitionRecord {
    const from = this.lastState.get(input.correlationId) ?? null;
    assertTransition(from, input.toState);
    const record: TransitionRecord = {
      seq: this.lines.length + 1,
      at: this.now().toISOString(),
      correlationId: input.correlationId,
      obligationKey: input.obligationKey,
      fromState: from,
      toState: input.toState,
      actor: input.actor,
      reasonCode: input.reasonCode,
      reasons: [...input.reasons],
      policyVersion: input.policyVersion,
      attemptId: input.attemptId,
      ledgerHash: input.ledgerHash,
      evidence: input.evidence,
    };
    if (this.path !== null) {
      appendDurably(this.path, `${JSON.stringify(record)}\n`);
    }
    this.remember(record);
    return record;
  }

  /** The state an invoice is in now, or null when it has not been seen. */
  stateOf(correlationId: string): State | null {
    return this.lastState.get(correlationId) ?? null;
  }

  correlationIds(): ReadonlySet<string> {
    return new Set(this.lastState.keys());
  }

  records(): readonly TransitionRecord[] {
    return this.lines;
  }

  /**
   * True when a payment for this obligation may have reached the ledger, or may still do so. It looks at each
   * invoice's latest state, so a payment that failed does not block a corrected retry.
   */
  blocksPayment(obligationKey: string): boolean {
    const latest = new Map<string, TransitionRecord>();
    for (const record of this.lines) {
      if (record.obligationKey === obligationKey) {
        latest.set(record.correlationId, record);
      }
    }
    return [...latest.values()].some((record) => PAYMENT_BLOCKING.has(record.toState));
  }
}

function readTextOrEmpty(path: string): string {
  try {
    // The path is the agent's own log file, named in its configuration.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function appendDurably(path: string, text: string): void {
  // The path is the agent's own log file, named in its configuration.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Holds a directory lock for one agent run, so two runs cannot write the same log. A run that is killed leaves the
 * lock behind; the operator checks that no run is alive and removes the directory (see the test log, S-028).
 */
export function withRunLock<T>(dir: string, work: () => T): T {
  const lock = acquireLock(dir);
  try {
    return work();
  } finally {
    releaseLock(lock);
  }
}

/** The same lock for work that runs for a long time, such as the watcher. The lock is held until the promise settles. */
export async function withRunLockAsync<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const lock = acquireLock(dir);
  try {
    return await work();
  } finally {
    releaseLock(lock);
  }
}

function acquireLock(dir: string): string {
  const lock = join(dir, 'run.lock');
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(lock);
  } catch {
    throw new TransitionLogError(
      'another agent run holds the lock. Check that no run is alive, then remove the run.lock folder',
    );
  }
  return lock;
}

function releaseLock(lock: string): void {
  rmSync(lock, { recursive: true, force: true });
}
