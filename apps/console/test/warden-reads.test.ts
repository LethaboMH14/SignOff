/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type TransitionRecord } from '../../agent/src/log/transition-log.js';
import {
  latestInvoicesOf,
  OverviewView,
  ProposalList,
  proposalRecordOf,
  readTransitions,
} from '../src/server/warden-reads.js';

const ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const CORRELATION = 'a'.repeat(64);

function record(overrides: Partial<TransitionRecord>): TransitionRecord {
  return {
    seq: 1,
    at: '2026-11-11T09:00:00.000Z',
    correlationId: CORRELATION,
    obligationKey: null,
    fromState: null,
    toState: 'RECEIVED',
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
    ...overrides,
  };
}

describe('the Warden views the console accepts', () => {
  it('keeps only the fields the console uses, so a new Warden field never reaches the browser', () => {
    const parsed = ProposalList.parse({
      proposals: [
        {
          attemptId: ATTEMPT,
          decision: 'ALLOW',
          evaluatedAt: '2026-11-11T09:00:00.000Z',
          reasons: [],
          unexpectedField: 'do not keep me',
          payment: {
            status: 'paid',
            attemptNumber: 1,
            obligationKey: 'x',
            supplierId: 'SUP-ABCD1234',
            currency: 'USD',
            ledgerCurrency: 'USD',
            amountMinor: 100,
            createdAt: '2026-11-11T09:00:00.000Z',
            ledgerIndex: 1,
            engineResult: 'tesSUCCESS',
            transactionHash: null,
            wardenBlob: 'do not keep me either',
          },
        },
      ],
    });
    const json = JSON.stringify(parsed);
    expect(json).not.toContain('do not keep me');
    const first = parsed.proposals.at(0);
    if (first === undefined) {
      throw new Error('the proposal list lost its entry');
    }
    expect(proposalRecordOf(first).reasonCodes).toEqual([]);
  });

  it('refuses an overview with a negative limit', () => {
    expect(() =>
      OverviewView.parse({
        paused: false,
        policyVersion: '2026-11-10.1',
        limits: { perPaymentMinor: -1, supplierDailyMinor: 1, dailyTotalMinor: 1 },
        usageToday: { day: '2026-11-11', totalMinor: 0 },
        pendingLimitChange: null,
      }),
    ).toThrow();
  });
});

describe('the latest state of each invoice', () => {
  it('keeps the highest sequence, and the latest attempt id that is set', () => {
    const latest = latestInvoicesOf([
      record({ seq: 2, toState: 'EXTRACTED' }),
      record({ seq: 1, toState: 'RECEIVED' }),
      record({ seq: 3, toState: 'SUBMITTED', attemptId: ATTEMPT }),
      record({ seq: 4, toState: 'RECONCILED', attemptId: null }),
    ]);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({
      agentState: 'RECONCILED',
      attemptId: ATTEMPT,
      correlationId: CORRELATION,
    });
  });
});

describe('reading the agent log', () => {
  let directory = '';
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'console-reads-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads an empty history when the agent has not written its log yet', () => {
    expect(readTransitions(join(directory, 'missing.jsonl'))).toEqual({ records: [], damaged: 0 });
  });

  it('counts a damaged line and skips it', () => {
    const path = join(directory, 'agent-log.jsonl');
    writeFileSync(path, `not json\n${JSON.stringify(record({ seq: 1 }))}\n`);
    const { records, damaged } = readTransitions(path);
    expect(records).toHaveLength(1);
    expect(damaged).toBe(1);
  });
});
