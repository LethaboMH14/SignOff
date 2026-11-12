import { describe, expect, it } from 'vitest';

import { evidenceStagesOf, stopOf, type EvidencePathInput } from '../src/model/evidence-path.js';
import { limitChangeOf, limitEffectOf, limitSymbolOf } from '../src/model/limits.js';

describe('limit changes', () => {
  it('a lower limit applies at once; a higher one needs a second operator', () => {
    expect(limitChangeOf(5000_00, 4000_00)).toBe('lower');
    expect(limitChangeOf(5000_00, 6000_00)).toBe('raise');
    expect(limitChangeOf(5000_00, 5000_00)).toBe('unchanged');
  });

  it('says the effect in words and never relies on a symbol alone', () => {
    expect(limitEffectOf('lower')).toContain('applies at once');
    expect(limitEffectOf('raise')).toContain('second operator');
    expect(limitEffectOf(null)).toContain('Enter an amount');
    expect(limitSymbolOf('lower')).not.toBe(limitSymbolOf('raise'));
  });
});

const CLEAN: EvidencePathInput = {
  displayState: 'Paid',
  supplierId: 'SUP-1',
  failedRule: null,
  wardenDecision: { decision: 'ALLOW', policyVersion: 'v3' },
  payoutChange: null,
};

describe('the evidence path', () => {
  it('runs to settlement only for a validated Paid invoice with no payout change', () => {
    const stages = evidenceStagesOf(CLEAN);
    expect(stages.map((stage) => stage.outcome)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(stopOf(stages)).toBeNull();
  });

  it('stops at a changed payout destination and never reaches settlement', () => {
    const stages = evidenceStagesOf({
      ...CLEAN,
      displayState: 'Held',
      payoutChange: { status: 'requested', why: 'Not confirmed yet.' },
    });
    expect(stopOf(stages)?.id).toBe('payout');
    expect(stages[4]?.outcome).toBe('not-reached');
  });

  it('never shows settlement as done unless the desk shows Paid', () => {
    for (const displayState of [
      'Not confirmed',
      'In progress',
      'Not paid',
      'Needs a person',
    ] as const) {
      const stages = evidenceStagesOf({ ...CLEAN, displayState });
      expect(stages[4]?.outcome, displayState).not.toBe('done');
    }
  });

  it('stops at policy when the Warden holds, and at checks when a check fails', () => {
    expect(
      stopOf(
        evidenceStagesOf({ ...CLEAN, wardenDecision: { decision: 'HOLD', policyVersion: 'v3' } }),
      )?.id,
    ).toBe('policy');
    expect(
      stopOf(
        evidenceStagesOf({
          ...CLEAN,
          failedRule: { code: 'AMOUNT_MISMATCH', sentence: 'Amount differs.' },
        }),
      )?.id,
    ).toBe('checks');
  });
});
