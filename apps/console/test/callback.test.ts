import { describe, expect, it } from 'vitest';

import type { HolidayCalendar } from '../../../packages/shared/src/calendar/index.js';
import { coolingOffEnd, digitsOf, recordCallback } from '../src/server/callback.js';

const MASTER = '+27 11 555 0100';
const LIVE: HolidayCalendar = {
  source: 'Nager.Date (test)',
  sourceKind: 'live',
  fallbackReason: null,
  countries: {
    ZA: { years: [2026], dates: new Set(['2026-09-24', '2026-12-16', '2026-12-25', '2026-12-26']) },
    ZM: { years: [2026], dates: new Set() },
  },
};
const base = { operatorId: 'op-a', spokeTo: 'Accounts, Ms Dube', calledAt: '2026-09-23T10:00:00+02:00', confirmed: true };

describe('supplier bank-change call-back', () => {
  it('accepts a call to the master-record number, in any written form', () => {
    expect(digitsOf(MASTER)).toBe('0115550100');
    const outcome = recordCallback({ ...base, dialled: '011 555 0100' }, MASTER);
    expect(outcome.ok).toBe(true);
  });

  it('refuses a number that is not on the master record, so the change stays held', () => {
    const outcome = recordCallback({ ...base, dialled: '011 555 0199' }, MASTER);
    expect(outcome).toMatchObject({ ok: false, code: 'NUMBER_NOT_ON_MASTER' });
  });

  it('refuses an unconfirmed call and bad input', () => {
    expect(recordCallback({ ...base, dialled: MASTER, confirmed: false }, MASTER)).toMatchObject({
      ok: false,
      code: 'NOT_CONFIRMED',
    });
    expect(recordCallback({ ...base, dialled: MASTER, operatorId: ' ' }, MASTER)).toMatchObject({
      ok: false,
      code: 'BAD_INPUT',
    });
    expect(recordCallback({ ...base, dialled: MASTER, calledAt: 'not a date' }, MASTER)).toMatchObject({
      ok: false,
      code: 'BAD_INPUT',
    });
  });

  it('counts the cooling-off in business days, skipping Heritage Day and the weekend', () => {
    // Wed 23 Sep 2026 10:00 SAST + 3 business days: Thu 24 is Heritage Day, so Fri 25, Mon 28, Tue 29.
    const end = coolingOffEnd(new Date('2026-09-23T10:00:00+02:00'), 3, 'ZA', LIVE);
    expect(end).toEqual({ status: 'ends', endsAt: '2026-09-29T08:00:00.000Z', source: 'Nager.Date (test)' });
  });

  it('holds, never guesses, when the calendar is missing, a fixture, or does not cover the year', () => {
    const at = new Date('2026-09-23T10:00:00+02:00');
    expect(coolingOffEnd(at, 3, 'ZA', null)).toMatchObject({ status: 'hold' });
    expect(coolingOffEnd(at, 3, 'ZA', { ...LIVE, sourceKind: 'fixture' })).toMatchObject({ status: 'hold' });
    expect(coolingOffEnd(new Date('2027-12-20T10:00:00+02:00'), 3, 'ZA', LIVE)).toMatchObject({
      status: 'hold',
    });
  });
});
