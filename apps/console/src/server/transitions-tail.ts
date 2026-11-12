import { closeSync, openSync, readSync, statSync } from 'node:fs';

import { TransitionRecord } from '../../../agent/src/log/transition-log.js';

/**
 * Follows the agent's append-only transition log, one JSON object per line. A line that is still being written waits
 * for its newline. A line that does not match the agent's schema is counted as damaged and is never shown. If the file
 * shrinks (it was replaced or truncated), reading starts again from the top.
 */

const NEWLINE = 0x0a;

export interface TailRead {
  readonly records: readonly TransitionRecord[];
  readonly damaged: number;
}

function sizeOf(path: string): number {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the agent log the operator names at start-up
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

function readRange(path: string, position: number, length: number): Buffer {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the agent log the operator names at start-up
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(descriptor, buffer, 0, length, position);
    return buffer.subarray(0, read);
  } finally {
    closeSync(descriptor);
  }
}

/** Parses complete lines. Empty lines are skipped; anything else that does not match the schema is damaged. */
export function parseLines(text: string): TailRead {
  const records: TransitionRecord[] = [];
  let damaged = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(line) as unknown;
    } catch {
      damaged += 1;
      continue;
    }
    const parsed = TransitionRecord.safeParse(json);
    if (parsed.success) {
      records.push(parsed.data);
    } else {
      damaged += 1;
    }
  }
  return { records, damaged };
}

export class TransitionTail {
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly path: string) {}

  /** What was appended since the last call. Each record is returned once. */
  readNew(): TailRead {
    const size = sizeOf(this.path);
    if (size < this.offset) {
      this.offset = 0;
      this.pending = Buffer.alloc(0);
    }
    if (size > this.offset) {
      const chunk = readRange(this.path, this.offset, size - this.offset);
      this.offset = size;
      this.pending = Buffer.concat([this.pending, chunk]);
    }
    const end = this.pending.lastIndexOf(NEWLINE);
    if (end === -1) {
      return { records: [], damaged: 0 };
    }
    const complete = this.pending.subarray(0, end).toString('utf8');
    this.pending = Buffer.from(this.pending.subarray(end + 1));
    return parseLines(complete);
  }
}
