import { describe, expect, it } from 'vitest';

import { WardenDecision } from '../../src/schemas/warden-decision.js';
import { FIXTURE_OBLIGATION_KEY } from '../helpers/fixtures.js';

const common = {
  schemaVersion: 1,
  proposalFingerprint: FIXTURE_OBLIGATION_KEY,
  policyVersion: '2026-11-10.1',
  evaluatedAt: '2026-11-10T10:00:01Z',
};

const pairedHold = {
  code: 'PAYEE_CHANGED',
  message: 'Payout details differ from the verified record.',
};

describe('WardenDecision schema', () => {
  it('accepts ALLOW with no reasons', () => {
    expect(WardenDecision.safeParse({ ...common, decision: 'ALLOW', reasons: [] }).success).toBe(
      true,
    );
  });

  it('refuses ALLOW that still carries a reason, because the two would contradict', () => {
    const decision = { ...common, decision: 'ALLOW', reasons: [pairedHold] };
    expect(WardenDecision.safeParse(decision).success).toBe(false);
  });

  it.each(['HOLD', 'REFUSE'])('requires at least one reason for %s', (kind) => {
    expect(WardenDecision.safeParse({ ...common, decision: kind, reasons: [] }).success).toBe(
      false,
    );
    expect(
      WardenDecision.safeParse({ ...common, decision: kind, reasons: [pairedHold] }).success,
    ).toBe(true);
  });

  it('rejects a reason code outside the agreed list', () => {
    const decision = {
      ...common,
      decision: 'HOLD',
      reasons: [{ code: 'MAYBE_FINE', message: 'Looks okay.' }],
    };
    expect(WardenDecision.safeParse(decision).success).toBe(false);
  });

  it('rejects an unknown decision value', () => {
    expect(WardenDecision.safeParse({ ...common, decision: 'MAYBE', reasons: [] }).success).toBe(
      false,
    );
  });

  it('rejects an empty reason message', () => {
    const decision = {
      ...common,
      decision: 'HOLD',
      reasons: [{ code: 'DUPLICATE', message: '' }],
    };
    expect(WardenDecision.safeParse(decision).success).toBe(false);
  });
});
