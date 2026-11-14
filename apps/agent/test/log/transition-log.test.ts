/* eslint-disable security/detect-non-literal-fs-filename -- the tests create their own folders */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TransitionLog,
  TransitionLogError,
  withRunLock,
  type Evidence,
  type NewTransition,
} from '../../src/log/transition-log.js';
import {
  assertTransition,
  PAYMENT_BLOCKING,
  STATES,
  TransitionError,
} from '../../src/workflow/states.js';

const WHEN = new Date('2026-11-10T10:00:00.000Z');
const FILE = 'c'.repeat(64);
const KEY = 'd'.repeat(64);

const EVIDENCE: Evidence = {
  fileSha256: FILE,
  recordSha256s: [],
  quoteSha256s: [],
  model: null,
  modelCalls: 0,
  screenCodes: [],
};

function move(
  toState: NewTransition['toState'],
  overrides: Partial<NewTransition> = {},
): NewTransition {
  return {
    correlationId: FILE,
    obligationKey: KEY,
    toState,
    actor: 'intake',
    reasonCode: 'OK',
    reasons: [],
    policyVersion: '2026-11-10.1',
    attemptId: null,
    ledgerHash: null,
    evidence: EVIDENCE,
    ...overrides,
  };
}

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signoff-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('state moves', () => {
  it('allows the forward path and the holds, and nothing else', () => {
    expect(() => {
      assertTransition(null, 'RECEIVED');
    }).not.toThrow();
    expect(() => {
      assertTransition('RECEIVED', 'EXTRACTED');
    }).not.toThrow();
    expect(() => {
      assertTransition('WARDEN_ELIGIBLE', 'SIGNED');
    }).not.toThrow();
    expect(() => {
      assertTransition('SUBMITTED', 'VALIDATED');
    }).not.toThrow();
    expect(() => {
      assertTransition('EXTRACTED', 'WARDEN_ELIGIBLE');
    }).toThrow(TransitionError);
    expect(() => {
      assertTransition('RECEIVED', 'RECONCILED');
    }).toThrow('a move from RECEIVED to RECONCILED is not allowed');
    expect(() => {
      assertTransition(null, 'SUBMITTED');
    }).toThrow('a move from nothing to SUBMITTED is not allowed');
  });

  it('does not let a held or quarantined invoice move on', () => {
    for (const from of [
      'QUARANTINED',
      'HELD',
      'FAILED',
      'RECONCILED',
      'RECONCILIATION_EXCEPTION',
    ] as const) {
      for (const to of STATES) {
        expect(() => {
          assertTransition(from, to);
        }).toThrow(TransitionError);
      }
    }
  });

  it('treats the payment-blocking states as the ones that may reach the ledger', () => {
    expect([...PAYMENT_BLOCKING].sort()).toEqual(
      ['RECONCILED', 'RECONCILIATION_EXCEPTION', 'SUBMITTED', 'VALIDATED'].sort(),
    );
  });
});

describe('TransitionLog in memory', () => {
  it('assigns sequence numbers, the time and the state moved from', () => {
    const log = TransitionLog.open(null, () => WHEN);
    const first = log.append(move('RECEIVED'));
    const second = log.append(move('EXTRACTED', { actor: 'extractor' }));
    expect(first).toMatchObject({
      seq: 1,
      fromState: null,
      toState: 'RECEIVED',
      at: WHEN.toISOString(),
    });
    expect(second).toMatchObject({ seq: 2, fromState: 'RECEIVED', toState: 'EXTRACTED' });
    expect(log.stateOf(FILE)).toBe('EXTRACTED');
    expect(log.stateOf('e'.repeat(64))).toBeNull();
    expect(log.correlationIds()).toEqual(new Set([FILE]));
  });

  it('refuses a move the table does not allow, and writes nothing for it', () => {
    const log = TransitionLog.open(null, () => WHEN);
    log.append(move('RECEIVED'));
    expect(() => log.append(move('RECONCILED'))).toThrow(TransitionError);
    expect(log.records()).toHaveLength(1);
    expect(log.stateOf(FILE)).toBe('RECEIVED');
  });

  it('keeps the reasons and evidence it was given, and copies them', () => {
    const log = TransitionLog.open(null, () => WHEN);
    const reasons = ['supplierName:QUOTE_NOT_FOUND'];
    const record = log.append(move('RECEIVED', { reasons }));
    reasons.push('later');
    expect(record.reasons).toEqual(['supplierName:QUOTE_NOT_FOUND']);
  });

  it('blocks a new payment while an earlier one may still reach the ledger, and not after it failed', () => {
    const log = TransitionLog.open(null, () => WHEN);
    log.append(move('RECEIVED'));
    log.append(move('EXTRACTED', { actor: 'extractor' }));
    log.append(move('EVIDENCE_VERIFIED', { actor: 'verifier' }));
    log.append(move('WARDEN_ELIGIBLE', { actor: 'matcher' }));
    log.append(move('SIGNED', { actor: 'signer' }));
    log.append(move('SUBMITTED', { actor: 'submitter' }));
    expect(log.blocksPayment(KEY)).toBe(true);
    expect(log.blocksPayment('f'.repeat(64))).toBe(false);

    log.append(move('FAILED', { actor: 'warden', reasonCode: 'FAILED' }));
    expect(log.blocksPayment(KEY)).toBe(false);
  });

  it('ignores obligations without a key', () => {
    const log = TransitionLog.open(null, () => WHEN);
    log.append(move('RECEIVED', { obligationKey: null }));
    expect(log.blocksPayment(KEY)).toBe(false);
  });
});

describe('TransitionLog on disk', () => {
  it('writes one line per move and replays to the same state', () => {
    const path = join(dir, 'agent-log.jsonl');
    const log = TransitionLog.open(path, () => WHEN);
    log.append(move('RECEIVED'));
    log.append(move('HELD', { actor: 'extractor', reasonCode: 'MODEL_CALL_FAILED' }));

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const reopened = TransitionLog.open(path, () => WHEN);
    expect(reopened.stateOf(FILE)).toBe('HELD');
    expect(reopened.records().map((record) => record.reasonCode)).toEqual([
      'OK',
      'MODEL_CALL_FAILED',
    ]);
    expect(() => reopened.append(move('QUARANTINED', { actor: 'screen' }))).toThrow(
      TransitionError,
    );
  });

  it('starts empty when the file does not exist yet', () => {
    const log = TransitionLog.open(join(dir, 'new.jsonl'), () => WHEN);
    expect(log.records()).toHaveLength(0);
  });

  it('refuses a damaged line and says where', () => {
    const path = join(dir, 'damaged.jsonl');
    writeFileSync(path, '{not json}\n');
    expect(() => TransitionLog.open(path, () => WHEN)).toThrow(
      'the transition log is damaged at line 1',
    );
  });

  it('refuses a line that does not match the record shape', () => {
    const path = join(dir, 'shape.jsonl');
    writeFileSync(path, `${JSON.stringify({ seq: 1, extra: true })}\n`);
    expect(() => TransitionLog.open(path, () => WHEN)).toThrow('damaged at line 1');
  });

  it('refuses a log whose sequence numbers are out of order', () => {
    const source = TransitionLog.open(null, () => WHEN);
    const first = source.append(move('RECEIVED'));
    const path = join(dir, 'order.jsonl');
    writeFileSync(path, `${JSON.stringify({ ...first, seq: 2 })}\n`);
    expect(() => TransitionLog.open(path, () => WHEN)).toThrow('out of order at line 1');
  });

  it('refuses a log that holds a move the table does not allow', () => {
    const source = TransitionLog.open(null, () => WHEN);
    const first = source.append(move('RECEIVED'));
    const illegal = { ...first, seq: 2, fromState: 'RECEIVED', toState: 'RECONCILED' };
    const path = join(dir, 'illegal.jsonl');
    writeFileSync(path, `${JSON.stringify(first)}\n\n${JSON.stringify(illegal)}\n`);
    expect(() => TransitionLog.open(path, () => WHEN)).toThrow(
      'a move that is not allowed at line 3',
    );
  });

  it('refuses a log whose recorded origin state does not match the one before it', () => {
    const source = TransitionLog.open(null, () => WHEN);
    const first = source.append(move('RECEIVED'));
    const wrongOrigin = { ...first, seq: 2, fromState: 'EXTRACTED', toState: 'EXTRACTED' };
    const path = join(dir, 'origin.jsonl');
    writeFileSync(path, `${JSON.stringify(first)}\n${JSON.stringify(wrongOrigin)}\n`);
    expect(() => TransitionLog.open(path, () => WHEN)).toThrow('out of order at line 2');
  });

  it('reports a log path that exists but cannot be read as an error', () => {
    const path = join(dir, 'a-folder.jsonl');
    mkdirSync(path);
    expect(() => TransitionLog.open(path, () => WHEN)).toThrow();
  });
});

describe('withRunLock', () => {
  it('runs the work once and releases the lock afterwards', () => {
    const result = withRunLock(dir, () => 'done');
    expect(result).toBe('done');
    expect(() => withRunLock(dir, () => 'again')).not.toThrow();
  });

  it('refuses a second run while the lock is held, and releases it when the work fails', () => {
    expect(() =>
      withRunLock(dir, () => {
        expect(() => withRunLock(dir, () => 'second')).toThrow(TransitionLogError);
        throw new Error('work failed');
      }),
    ).toThrow('work failed');
    expect(() => withRunLock(dir, () => 'third')).not.toThrow();
  });
});
