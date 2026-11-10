import { describe, expect, it } from 'vitest';
import { classifySubmitResult } from '../src/results.js';
import { diffSignerList } from '../src/signer-list.js';
import { decide, type Expected, type LedgerLookup } from '../src/reconcile.js';
import {
  assertTransition,
  JournalError,
  nextStep,
  replay,
  type JournalRecord,
  type PaymentView,
} from '../src/journal.js';

const A = 'rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const B = 'rBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2';
const C = 'rCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3';
const CURRENCY = '524C555344000000000000000000000000000000';

describe('classifySubmitResult', () => {
  it('classifies every engine-result family the flows can meet', () => {
    expect(classifySubmitResult('tesSUCCESS')).toBe('accepted');
    expect(classifySubmitResult('terQUEUED')).toBe('accepted');
    expect(classifySubmitResult('tecUNFUNDED_PAYMENT')).toBe('applied-failure');
    expect(classifySubmitResult('tefBAD_QUORUM')).toBe('rejected');
    expect(classifySubmitResult('tefMASTER_DISABLED')).toBe('rejected');
    expect(classifySubmitResult('temBAD_FEE')).toBe('rejected');
    expect(classifySubmitResult('terPRE_SEQ')).toBe('deferred');
    expect(classifySubmitResult('telCAN_NOT_QUEUE')).toBe('deferred');
    expect(classifySubmitResult('weirdResult')).toBe('unknown');
  });
});

describe('diffSignerList', () => {
  const expected = {
    quorum: 2,
    entries: [
      { account: B, weight: 1 },
      { account: C, weight: 1 },
    ],
  };

  it('is empty when the ledger matches exactly, in any order', () => {
    expect(
      diffSignerList(expected, {
        quorum: 2,
        entries: [
          { account: C, weight: 1 },
          { account: B, weight: 1 },
        ],
      }),
    ).toEqual([]);
  });

  it('reports each kind of difference as a code, never an address', () => {
    expect(diffSignerList(expected, null)).toEqual(['missing']);
    expect(diffSignerList(expected, { quorum: 1, entries: expected.entries })).toEqual(['quorum']);
    expect(diffSignerList(expected, { quorum: 2, entries: [{ account: B, weight: 1 }] })).toEqual([
      'entry-count',
      'entry-missing',
    ]);
    expect(
      diffSignerList(expected, {
        quorum: 2,
        entries: [
          { account: B, weight: 2 },
          { account: C, weight: 1 },
        ],
      }),
    ).toEqual(['weight']);
    expect(
      diffSignerList(expected, {
        quorum: 2,
        entries: [
          { account: B, weight: 1 },
          { account: A, weight: 1 },
        ],
      }),
    ).toEqual(['entry-missing']);
  });
});

describe('decide', () => {
  const xrp: Expected = { kind: 'xrp', drops: '1000' };
  const iou: Expected = { kind: 'iou', amount: { currency: CURRENCY, issuer: C, value: '2.5' } };
  const validated = (
    overrides: Partial<Extract<LedgerLookup, { status: 'validated' }>>,
  ): LedgerLookup => ({
    status: 'validated',
    engineResult: 'tesSUCCESS',
    ledgerIndex: 100,
    delivered: { kind: 'xrp', drops: '1000' },
    ...overrides,
  });

  it('pays only a validated success that delivered the expected XRP amount', () => {
    expect(
      decide({
        expected: xrp,
        lookup: validated({}),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }),
    ).toEqual({ kind: 'paid', ledgerIndex: 100 });
  });

  it('pays a validated IOU success whose delivered value matches', () => {
    const delivered = {
      kind: 'iou' as const,
      amount: { currency: CURRENCY, issuer: C, value: '2.50' },
    };
    expect(
      decide({
        expected: iou,
        lookup: validated({ delivered }),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }).kind,
    ).toBe('paid');
  });

  it('holds a validated success whose delivered amount differs or is unknown, never pays it', () => {
    expect(
      decide({
        expected: xrp,
        lookup: validated({ delivered: { kind: 'xrp', drops: '999' } }),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }),
    ).toEqual({
      kind: 'hold',
      reason: 'delivered-mismatch',
    });
    expect(
      decide({
        expected: xrp,
        lookup: validated({ delivered: { kind: 'unknown' } }),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }).kind,
    ).toBe('hold');
    expect(
      decide({
        expected: iou,
        lookup: validated({ delivered: { kind: 'xrp', drops: '1000' } }),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }).kind,
    ).toBe('hold');
  });

  it('reports a validated failure as failed, with its result code', () => {
    expect(
      decide({
        expected: xrp,
        lookup: validated({ engineResult: 'tecUNFUNDED_PAYMENT' }),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }),
    ).toEqual({
      kind: 'failed',
      engineResult: 'tecUNFUNDED_PAYMENT',
      ledgerIndex: 100,
    });
  });

  it('holds a transaction validated after its last ledger sequence, which should be impossible', () => {
    expect(
      decide({
        expected: xrp,
        lookup: validated({ ledgerIndex: 130 }),
        lastValidatedLedger: 131,
        lastLedgerSequence: 120,
      }),
    ).toEqual({
      kind: 'hold',
      reason: 'validated-after-expiry',
    });
  });

  it('waits while a missing transaction could still validate, and expires it only after its window closed', () => {
    expect(
      decide({
        expected: xrp,
        lookup: { status: 'not-validated' },
        lastValidatedLedger: 120,
        lastLedgerSequence: 120,
      }),
    ).toEqual({ kind: 'wait' });
    expect(
      decide({
        expected: xrp,
        lookup: { status: 'not-validated' },
        lastValidatedLedger: 121,
        lastLedgerSequence: 120,
      }),
    ).toEqual({ kind: 'expired' });
  });

  it('treats a transaction that moves no value as paid on tesSUCCESS alone', () => {
    expect(
      decide({
        expected: { kind: 'none' },
        lookup: validated({ delivered: { kind: 'unknown' } }),
        lastValidatedLedger: 101,
        lastLedgerSequence: 120,
      }).kind,
    ).toBe('paid');
  });
});

function record(overrides: Partial<JournalRecord>): JournalRecord {
  return {
    paymentId: 'p1',
    attempt: 1,
    state: 'prepared',
    at: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

function viewOf(state: JournalRecord['state']): PaymentView {
  return { paymentId: 'p', attempt: 1, state, latest: record({ state }), submissions: 0 };
}

describe('journal state machine', () => {
  it('allows the documented transitions and nothing else', () => {
    expect(() => {
      assertTransition(undefined, 'prepared');
    }).not.toThrow();
    expect(() => {
      assertTransition(undefined, 'submitting');
    }).toThrow(JournalError);
    expect(() => {
      assertTransition('prepared', 'submitting');
    }).not.toThrow();
    expect(() => {
      assertTransition('submitting', 'submitted');
    }).not.toThrow();
    expect(() => {
      assertTransition('submitted', 'submitting');
    }).not.toThrow();
    expect(() => {
      assertTransition('submitted', 'paid');
    }).not.toThrow();
    expect(() => {
      assertTransition('paid', 'submitting');
    }).toThrow('illegal transition paid to submitting');
    expect(() => {
      assertTransition('prepared', 'paid');
    }).toThrow('illegal transition');
  });

  it('replays a complete two-step history into a view with the latest state', () => {
    const views = replay([
      record({ state: 'prepared', txBlob: 'AA', hash: 'H1' }),
      record({ state: 'submitting' }),
      record({ state: 'submitted', engineResult: 'tesSUCCESS' }),
      record({ state: 'paid', ledgerIndex: 100 }),
    ]);
    const view = views.get('p1');
    if (view === undefined) {
      throw new Error('no view for the payment');
    }
    expect(view.state).toBe('paid');
    expect(view.submissions).toBe(1);
    expect(nextStep(view)).toBe('none');
  });

  it('allows a new attempt only after the previous attempt expired', () => {
    const expired = [
      record({ state: 'prepared' }),
      record({ state: 'submitting' }),
      record({ state: 'expired' }),
    ];
    const next = record({ attempt: 2, state: 'prepared', paymentId: 'p1' });
    expect(replay([...expired, next]).get('p1')?.attempt).toBe(2);
    expect(() =>
      replay([record({ state: 'prepared' }), record({ state: 'submitting' }), next]),
    ).toThrow('only after the previous attempt expired');
    expect(() =>
      replay([
        record({ state: 'prepared' }),
        record({ state: 'submitted' }),
        record({ attempt: 2, state: 'prepared' }),
      ]),
    ).toThrow('illegal transition');
  });

  it('refuses journals that start in the wrong place or skip attempts', () => {
    expect(() => replay([record({ state: 'submitting' })])).toThrow(
      'an attempt must start with prepared',
    );
    expect(() => replay([record({ attempt: 2, state: 'prepared' })])).toThrow('attempt 1');
  });

  it('decides the next step from the state', () => {
    expect(nextStep(viewOf('prepared'))).toBe('submit');
    expect(nextStep(viewOf('submitting'))).toBe('reconcile');
    expect(nextStep(viewOf('submitted'))).toBe('reconcile');
    expect(nextStep(viewOf('expired'))).toBe('new-attempt');
    expect(nextStep(viewOf('held'))).toBe('none');
    expect(nextStep(viewOf('rejected'))).toBe('none');
    expect(nextStep(viewOf('failed'))).toBe('none');
    expect(nextStep(viewOf('paid'))).toBe('none');
  });
});
