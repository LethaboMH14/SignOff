import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditToCsv, buildAuditExport, csvCell, selectRecords } from '../../src/audit/export.js';
import { normaliseWardenLine } from '../../src/audit/warden-events.js';
import {
  TransitionLog,
  withRunLockAsync,
  type NewTransition,
} from '../../src/log/transition-log.js';
import { withRunLock } from '../../src/log/transition-log.js';

const WHEN = new Date('2026-11-10T10:00:00.000Z');
const FILE = 'c'.repeat(64);
const KEY = 'd'.repeat(64);
const ATTEMPT = '11111111-2222-4333-8444-555555555555';
const HASH = 'E'.repeat(64);

function move(
  toState: NewTransition['toState'],
  overrides: Partial<NewTransition> = {},
): NewTransition {
  return {
    correlationId: FILE,
    obligationKey: KEY,
    toState,
    actor: 'matcher',
    reasonCode: 'OK',
    reasons: [],
    policyVersion: '2026-11-10.1',
    attemptId: null,
    ledgerHash: null,
    evidence: {
      fileSha256: FILE,
      recordSha256s: ['f'.repeat(64)],
      quoteSha256s: [],
      model: 'test:model',
      modelCalls: 1,
      screenCodes: [],
    },
    ...overrides,
  };
}

function paidLog(): TransitionLog {
  const log = TransitionLog.open(null, () => WHEN);
  log.append(move('RECEIVED', { actor: 'intake' }));
  log.append(move('EXTRACTED', { actor: 'extractor' }));
  log.append(move('EVIDENCE_VERIFIED', { actor: 'verifier' }));
  log.append(move('WARDEN_ELIGIBLE', { attemptId: ATTEMPT }));
  log.append(move('SIGNED', { actor: 'signer', attemptId: ATTEMPT }));
  log.append(move('SUBMITTED', { actor: 'submitter', attemptId: ATTEMPT }));
  log.append(move('VALIDATED', { actor: 'warden', attemptId: ATTEMPT, ledgerHash: HASH }));
  log.append(move('RECONCILED', { actor: 'reconciler', attemptId: ATTEMPT, ledgerHash: HASH }));
  return log;
}

const WARDEN_LINES = [
  JSON.stringify({
    type: 'decision.recorded',
    at: '2026-11-10T10:00:01.000Z',
    attemptId: ATTEMPT,
    decision: {
      schemaVersion: 1,
      decision: 'ALLOW',
      policyVersion: '2026-11-10.1',
      reasons: [],
      proposalFingerprint: 'b'.repeat(64),
    },
  }),
  JSON.stringify({
    type: 'attempt.submitting',
    at: '2026-11-10T10:00:02.000Z',
    attemptId: ATTEMPT,
    hash: HASH,
  }),
  JSON.stringify({
    type: 'attempt.settled',
    at: '2026-11-10T10:00:03.000Z',
    attemptId: ATTEMPT,
    status: 'paid',
    ledgerIndex: 1000,
    engineResult: 'tesSUCCESS',
  }),
  JSON.stringify({
    type: 'pause.set',
    at: '2026-11-10T10:00:04.000Z',
    paused: false,
    changedBy: 'ops',
  }),
  JSON.stringify({
    type: 'attempt.settled',
    at: '2026-11-10T10:00:05.000Z',
    attemptId: '99999999-8888-4777-8666-555555555555',
    status: 'paid',
  }),
  '{ not json',
  JSON.stringify({ hello: 'world' }),
];

describe('selectRecords', () => {
  it('selects by obligation, or by invoice when no obligation is given', () => {
    const log = paidLog();
    expect(selectRecords(log.records(), { obligationKey: KEY, correlationId: null })).toHaveLength(
      8,
    );
    expect(selectRecords(log.records(), { obligationKey: null, correlationId: FILE })).toHaveLength(
      8,
    );
    expect(
      selectRecords(log.records(), { obligationKey: 'e'.repeat(64), correlationId: null }),
    ).toHaveLength(0);
  });

  it('includes the moves before the obligation was known, for the same invoice file', () => {
    const log = TransitionLog.open(null, () => WHEN);
    log.append(move('RECEIVED', { actor: 'intake', obligationKey: null }));
    log.append(move('EXTRACTED', { actor: 'extractor', obligationKey: null }));
    log.append(move('EVIDENCE_VERIFIED', { actor: 'verifier', obligationKey: null }));
    log.append(move('WARDEN_ELIGIBLE', { actor: 'matcher' }));
    const otherFile = 'f'.repeat(64);
    log.append(
      move('RECEIVED', { correlationId: otherFile, actor: 'intake', obligationKey: null }),
    );
    log.append(
      move('QUARANTINED', {
        correlationId: otherFile,
        actor: 'intake',
        obligationKey: null,
        reasonCode: 'NO_TEXT_LAYER',
      }),
    );
    const selected = selectRecords(log.records(), { obligationKey: KEY, correlationId: null });
    expect(selected.map((record) => record.toState)).toEqual([
      'RECEIVED',
      'EXTRACTED',
      'EVIDENCE_VERIFIED',
      'WARDEN_ELIGIBLE',
    ]);
  });

  it('refuses a selector with neither an obligation nor an invoice', () => {
    expect(() => selectRecords([], { obligationKey: null, correlationId: null })).toThrow(
      'an audit export needs an obligation key or an invoice identifier',
    );
  });
});

describe('buildAuditExport', () => {
  it('joins the agent moves with the Warden events for the same attempt, and counts the lines it cannot read', () => {
    const exported = buildAuditExport({
      records: paidLog().records(),
      selector: { obligationKey: KEY, correlationId: null },
      wardenLines: WARDEN_LINES,
      now: WHEN,
    });
    expect(exported.schemaVersion).toBe(1);
    expect(exported.agentTransitions).toHaveLength(8);
    expect(exported.wardenEvents.map((event) => event.type)).toEqual([
      'decision.recorded',
      'attempt.submitting',
      'attempt.settled',
    ]);
    expect(exported.wardenEvents[0]).toMatchObject({
      source: 'warden',
      decision: 'ALLOW',
      policyVersion: '2026-11-10.1',
    });
    expect(exported.wardenEvents[2]).toMatchObject({
      status: 'paid',
      ledgerIndex: 1000,
      engineResult: 'tesSUCCESS',
    });
    expect(exported.unreadableWardenLines).toBe(2);
    expect(exported.generatedAt).toBe(WHEN.toISOString());
    expect(exported.notice).toContain('SHA-256');
  });

  it('exports no Warden events when no attempt was made', () => {
    const log = TransitionLog.open(null, () => WHEN);
    log.append(move('RECEIVED', { actor: 'intake' }));
    log.append(move('QUARANTINED', { actor: 'intake', reasonCode: 'NO_TEXT_LAYER' }));
    const exported = buildAuditExport({
      records: log.records(),
      selector: { obligationKey: null, correlationId: FILE },
      wardenLines: WARDEN_LINES,
      now: WHEN,
    });
    expect(exported.wardenEvents).toEqual([]);
    expect(exported.agentTransitions.map((record) => record.reasonCode)).toEqual([
      'OK',
      'NO_TEXT_LAYER',
    ]);
  });

  it('skips blank Warden lines without counting them as unreadable', () => {
    const exported = buildAuditExport({
      records: paidLog().records(),
      selector: { obligationKey: KEY, correlationId: null },
      wardenLines: ['', '   '],
      now: WHEN,
    });
    expect(exported.unreadableWardenLines).toBe(0);
  });
});

describe('normaliseWardenLine', () => {
  it('reads the four event types the export shows and ignores the rest', () => {
    const [decision, submitting, settled] = WARDEN_LINES.map((line) => normaliseWardenLine(line));
    expect(decision).toMatchObject({
      type: 'decision.recorded',
      attemptId: ATTEMPT,
      reasonCodes: [],
    });
    expect(submitting).toMatchObject({ type: 'attempt.submitting', hash: HASH });
    expect(settled).toMatchObject({ type: 'attempt.settled', status: 'paid' });
    expect(normaliseWardenLine(WARDEN_LINES[3] ?? '')).toBeNull();
  });

  it('reads reason codes from a decision and the awaiting event', () => {
    const line = JSON.stringify({
      type: 'attempt.awaiting',
      at: '2026-11-10T10:00:00.000Z',
      attemptId: ATTEMPT,
      decision: {
        decision: 'HOLD',
        reasons: [{ code: 'PAYEE_CHANGED', message: 'x' }],
      },
    });
    expect(normaliseWardenLine(line)).toMatchObject({
      decision: 'HOLD',
      reasonCodes: ['PAYEE_CHANGED'],
    });
  });

  it('gives null for an event without an attempt, and unreadable for a bad line', () => {
    expect(
      normaliseWardenLine(
        JSON.stringify({ type: 'supplier.enrolled', at: '2026-11-10T10:00:00.000Z' }),
      ),
    ).toBeNull();
    expect(normaliseWardenLine('not json')).toBe('unreadable');
    expect(
      normaliseWardenLine(
        JSON.stringify({ type: 'decision.recorded', at: 'yesterday', attemptId: ATTEMPT }),
      ),
    ).toBe('unreadable');
  });

  it('keeps a settled event that carries no optional fields', () => {
    const line = JSON.stringify({
      type: 'attempt.settled',
      at: '2026-11-10T10:00:00.000Z',
      attemptId: ATTEMPT,
    });
    expect(normaliseWardenLine(line)).toMatchObject({
      status: null,
      ledgerIndex: null,
      engineResult: null,
    });
  });

  it('keeps a decision event that carries no policy version or reasons', () => {
    const line = JSON.stringify({
      type: 'decision.recorded',
      at: '2026-11-10T10:00:00.000Z',
      attemptId: ATTEMPT,
      decision: { decision: 'ALLOW' },
    });
    expect(normaliseWardenLine(line)).toMatchObject({ policyVersion: null, reasonCodes: [] });
  });

  it('gives null for a decision type that has no decision block', () => {
    const line = JSON.stringify({
      type: 'decision.recorded',
      at: '2026-11-10T10:00:00.000Z',
      attemptId: ATTEMPT,
    });
    expect(normaliseWardenLine(line)).toBeNull();
  });
});

describe('auditToCsv', () => {
  it('writes a header, one row per agent move and one per Warden event, with the same columns', () => {
    const exported = buildAuditExport({
      records: paidLog().records(),
      selector: { obligationKey: KEY, correlationId: null },
      wardenLines: WARDEN_LINES,
      now: WHEN,
    });
    const rows = auditToCsv(exported).trim().split('\n');
    const header = rows[0] ?? '';
    expect(header.startsWith('source,seq,at,type')).toBe(true);
    expect(rows).toHaveLength(1 + 8 + 3);
    const columns = header.split(',').length;
    for (const row of rows.slice(1)) {
      expect(row.split(',').length).toBe(columns);
    }
    expect(rows.some((row) => row.startsWith('warden,'))).toBe(true);
  });

  it('quotes a cell that has a comma, a quote or a line break, and guards a leading formula character', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('\tcell')).toBe("'\tcell");
  });
});

describe('withRunLockAsync', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'signoff-lock-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('holds the lock while the async work runs, and releases it afterwards', async () => {
    const result = await withRunLockAsync(dir, async () => {
      await Promise.resolve();
      expect(() => withRunLock(dir, () => 'second')).toThrow('another agent run holds the lock');
      return 'done';
    });
    expect(result).toBe('done');
    expect(withRunLock(dir, () => 'third')).toBe('third');
  });

  it('releases the lock when the async work fails', async () => {
    await expect(withRunLockAsync(dir, () => Promise.reject(new Error('stopped')))).rejects.toThrow(
      'stopped',
    );
    expect(withRunLock(dir, () => 'after')).toBe('after');
  });
});
