/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseLines, TransitionTail } from '../src/server/transitions-tail.js';

const HASH = 'b'.repeat(64);

function lineOf(seq: number, toState = 'RECEIVED'): string {
  return JSON.stringify({
    seq,
    at: '2026-11-10T10:00:00.000Z',
    correlationId: HASH,
    obligationKey: null,
    fromState: null,
    toState,
    actor: 'intake',
    reasonCode: 'OK',
    reasons: [],
    policyVersion: '2026-11-10.1',
    attemptId: null,
    ledgerHash: null,
    evidence: {
      fileSha256: null,
      recordSha256s: [],
      quoteSha256s: [],
      model: null,
      modelCalls: 0,
      screenCodes: [],
    },
  });
}

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'console-tail-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('parseLines', () => {
  it('keeps the records that match the agent schema, and counts the lines that do not', () => {
    const result = parseLines(
      `${lineOf(1)}\n\nnot json\n${JSON.stringify({ seq: 2 })}\n${lineOf(2)}`,
    );
    expect(result.records.map((record) => record.seq)).toEqual([1, 2]);
    expect(result.damaged).toBe(2);
  });
});

describe('TransitionTail', () => {
  it('reads the whole log first, then only what is appended', () => {
    const path = join(directory, 'log.jsonl');
    writeFileSync(path, `${lineOf(1)}\n${lineOf(2)}\n`);
    const tail = new TransitionTail(path);
    expect(tail.readNew().records.map((record) => record.seq)).toEqual([1, 2]);
    expect(tail.readNew().records).toEqual([]);
    appendFileSync(path, `${lineOf(3)}\n`);
    expect(tail.readNew().records.map((record) => record.seq)).toEqual([3]);
  });

  it('waits for the newline of a line that is still being written', () => {
    const path = join(directory, 'log.jsonl');
    const full = lineOf(1);
    writeFileSync(path, full.slice(0, 40));
    const tail = new TransitionTail(path);
    expect(tail.readNew().records).toEqual([]);
    appendFileSync(path, `${full.slice(40)}\n`);
    expect(tail.readNew().records.map((record) => record.seq)).toEqual([1]);
  });

  it('starts again from the top when the file is replaced by a shorter one', () => {
    const path = join(directory, 'log.jsonl');
    writeFileSync(path, `${lineOf(1)}\n${lineOf(2)}\n`);
    const tail = new TransitionTail(path);
    expect(tail.readNew().records).toHaveLength(2);
    writeFileSync(path, `${lineOf(1)}\n`);
    expect(tail.readNew().records.map((record) => record.seq)).toEqual([1]);
  });

  it('reports nothing when the log does not exist yet', () => {
    const tail = new TransitionTail(join(directory, 'missing.jsonl'));
    expect(tail.readNew()).toEqual({ records: [], damaged: 0 });
  });
});
