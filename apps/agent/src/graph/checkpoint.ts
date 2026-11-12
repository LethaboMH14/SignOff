import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { BudgetSnapshot } from '../swarm/budget.js';

/**
 * Checkpoints: one JSON file per transition, written atomically (temp file, then rename), so a killed process leaves the
 * last complete file. A file that fails to parse stops the resume: the run is then held, never restarted from nothing.
 * The directory is the operator's private store. It holds invoice text for resumption and is never the decision log.
 */

export const CHECKPOINT_PHASES = ['start', 'spend', 'intent', 'done'] as const;
export type CheckpointPhase = (typeof CHECKPOINT_PHASES)[number];

export interface Checkpoint {
  readonly seq: number;
  /** The node to run next (phase start or done), or the node that is running (phase spend or intent). */
  readonly node: string;
  readonly phase: CheckpointPhase;
  readonly budget: BudgetSnapshot;
  /** The graph data, JSON-serialisable. Its shape is owned by graph/run.ts. */
  readonly data: Readonly<Record<string, unknown>>;
}

const StoredCheckpoint = z.strictObject({
  seq: z.int().min(1),
  node: z.string().min(1).max(40),
  phase: z.enum(CHECKPOINT_PHASES),
  budget: z.strictObject({ initial: z.int().min(0).max(3), repair: z.int().min(0).max(1) }),
  data: z.record(z.string(), z.unknown()),
});

export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointError';
  }
}

export interface CheckpointStore {
  save(correlationId: string, checkpoint: Checkpoint): void;
  /** The newest checkpoint for the run, or null when there is none. Throws on a damaged file. */
  latest(correlationId: string): Checkpoint | null;
}

/** An in-memory store, for tests. It keeps the same contract as the file store. */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly runs = new Map<string, Checkpoint[]>();

  save(correlationId: string, checkpoint: Checkpoint): void {
    const list = this.runs.get(correlationId) ?? [];
    list.push(JSON.parse(JSON.stringify(checkpoint)) as Checkpoint);
    this.runs.set(correlationId, list);
  }

  latest(correlationId: string): Checkpoint | null {
    const list = this.runs.get(correlationId) ?? [];
    const last = list[list.length - 1];
    return last === undefined ? null : (JSON.parse(JSON.stringify(last)) as Checkpoint);
  }

  /** Every checkpoint of a run, oldest first. For tests that need to pick a crash point. */
  all(correlationId: string): readonly Checkpoint[] {
    return this.runs.get(correlationId) ?? [];
  }
}

const SAFE_ID = /^[0-9a-f]{64}$/;

export class FileCheckpointStore implements CheckpointStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private runDir(correlationId: string): string {
    if (!SAFE_ID.test(correlationId)) {
      throw new CheckpointError('the correlation id must be a SHA-256 hex string');
    }
    return join(this.dir, correlationId);
  }

  save(correlationId: string, checkpoint: Checkpoint): void {
    const dir = this.runDir(correlationId);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
    mkdirSync(dir, { recursive: true });
    const name = `${String(checkpoint.seq).padStart(6, '0')}.json`;
    const target = join(dir, name);
    const temp = `${target}.tmp`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
    writeFileSync(temp, JSON.stringify(checkpoint), { encoding: 'utf8', flag: 'w' });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
    renameSync(temp, target);
  }

  latest(correlationId: string): Checkpoint | null {
    const dir = this.runDir(correlationId);
    let names: string[];
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
      names = readdirSync(dir)
        .filter((name) => /^\d{6}\.json$/.test(name))
        .sort();
    } catch {
      return null;
    }
    const last = names[names.length - 1];
    if (last === undefined) {
      return null;
    }
    let json: unknown;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
      json = JSON.parse(readFileSync(join(dir, last), 'utf8')) as unknown;
    } catch {
      throw new CheckpointError(
        'the newest checkpoint could not be read; the run is held for a person',
      );
    }
    const checked = StoredCheckpoint.safeParse(json);
    if (!checked.success) {
      throw new CheckpointError('the newest checkpoint is damaged; the run is held for a person');
    }
    return checked.data;
  }
}

/** A short, stable digest of a checkpoint's data, used in tests to compare runs. */
export function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
