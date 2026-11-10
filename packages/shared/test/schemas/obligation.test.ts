import { describe, expect, it } from 'vitest';

import { Obligation, remainingMinor } from '../../src/schemas/obligation.js';
import { validObligation } from '../helpers/fixtures.js';

describe('Obligation schema and invariants', () => {
  it('accepts an open obligation with nothing yet reserved or settled', () => {
    expect(Obligation.safeParse(validObligation()).success).toBe(true);
  });

  it('accepts a partial settlement that leaves a balance open', () => {
    const obligation = { ...validObligation(), settledMinor: 500000, version: 3 };
    expect(Obligation.safeParse(obligation).success).toBe(true);
    expect(remainingMinor(Obligation.parse(obligation))).toBe(750050);
  });

  it('computes what remains after reservations and settlements', () => {
    const obligation = Obligation.parse({
      ...validObligation(),
      reservedMinor: 200000,
      settledMinor: 300000,
    });
    expect(remainingMinor(obligation)).toBe(750050);
  });

  it('refuses reservations plus settlements larger than the approved amount', () => {
    const obligation = { ...validObligation(), reservedMinor: 1000000, settledMinor: 500000 };
    expect(Obligation.safeParse(obligation).success).toBe(false);
  });

  it('accepts a settled obligation only when it is fully settled with nothing reserved', () => {
    const settled = { ...validObligation(), status: 'SETTLED', settledMinor: 1250050 };
    expect(Obligation.safeParse(settled).success).toBe(true);
    expect(Obligation.safeParse({ ...settled, settledMinor: 1000000 }).success).toBe(false);
    expect(Obligation.safeParse({ ...settled, reservedMinor: 1 }).success).toBe(false);
  });

  it('refuses a cancelled obligation that still holds a reservation', () => {
    const cancelled = { ...validObligation(), status: 'CANCELLED', reservedMinor: 1 };
    expect(Obligation.safeParse(cancelled).success).toBe(false);
  });

  it('refuses a zero or negative approved amount', () => {
    expect(Obligation.safeParse({ ...validObligation(), approvedMinor: 0 }).success).toBe(false);
    expect(Obligation.safeParse({ ...validObligation(), approvedMinor: -1 }).success).toBe(false);
  });
});
