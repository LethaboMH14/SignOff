import { describe, expect, it } from 'vitest';

import {
  addBusinessDays,
  CalendarCoverageError,
  isBusinessDay,
  type HolidayCalendar,
} from '../../src/calendar/business-days.js';
import { fixtureHolidayCalendar } from '../../src/calendar/holidays.js';

const calendar: HolidayCalendar = fixtureHolidayCalendar();

/** A timestamp in South African time (UTC+2), from a wall-clock string. */
const sast = (wallClock: string): Date => new Date(`${wallClock}+02:00`);

describe('addBusinessDays (ZA, fixture holidays)', () => {
  it('moves from Monday to Tuesday by one business day', () => {
    expect(addBusinessDays(sast('2026-09-21T10:00:00'), 1, 'ZA', calendar)).toEqual(
      sast('2026-09-22T10:00:00'),
    );
  });

  it('skips the weekend: Friday plus one business day is Monday', () => {
    expect(addBusinessDays(sast('2026-09-18T10:00:00'), 1, 'ZA', calendar)).toEqual(
      sast('2026-09-21T10:00:00'),
    );
  });

  it('skips Heritage Day (Thursday 24 September 2026): Wednesday 23 plus 3 is Tuesday 29', () => {
    expect(addBusinessDays(sast('2026-09-23T10:00:00'), 3, 'ZA', calendar)).toEqual(
      sast('2026-09-29T10:00:00'),
    );
  });

  it('counts from the next working day when the start is a holiday: Heritage Day plus 1 is Friday 25', () => {
    expect(addBusinessDays(sast('2026-09-24T10:00:00'), 1, 'ZA', calendar)).toEqual(
      sast('2026-09-25T10:00:00'),
    );
  });

  it('skips Christmas and Boxing Day with the weekend: Wednesday 23 December plus 3 is Tuesday 29', () => {
    expect(addBusinessDays(sast('2026-12-23T16:30:00'), 3, 'ZA', calendar)).toEqual(
      sast('2026-12-29T16:30:00'),
    );
  });

  it('returns the start unchanged for zero business days, as a new Date', () => {
    const start = sast('2026-09-26T10:00:00');
    const result = addBusinessDays(start, 0, 'ZA', calendar);
    expect(result).toEqual(start);
    expect(result).not.toBe(start);
  });

  it('keeps a late local time of day across the weekend', () => {
    expect(addBusinessDays(sast('2026-09-18T23:30:00'), 1, 'ZA', calendar)).toEqual(
      sast('2026-09-21T23:30:00'),
    );
  });

  it('uses South African local time, not UTC, for the day: 01:00 SAST on Friday is still Friday', () => {
    const start = new Date('2026-09-17T23:00:00Z'); // 01:00 on Friday 18 September in SAST
    expect(addBusinessDays(start, 1, 'ZA', calendar)).toEqual(new Date('2026-09-20T23:00:00Z'));
  });

  it('refuses a negative or fractional number of days, and an invalid start', () => {
    expect(() => addBusinessDays(sast('2026-09-18T10:00:00'), -1, 'ZA', calendar)).toThrow(
      RangeError,
    );
    expect(() => addBusinessDays(sast('2026-09-18T10:00:00'), 1.5, 'ZA', calendar)).toThrow(
      RangeError,
    );
    expect(() => addBusinessDays(new Date(Number.NaN), 1, 'ZA', calendar)).toThrow(RangeError);
  });

  it('fails closed when the count runs into a year with no holiday data', () => {
    expect(() => addBusinessDays(sast('2026-12-31T10:00:00'), 1, 'ZA', calendar)).toThrow(
      CalendarCoverageError,
    );
  });
});

describe('addBusinessDays (ZM, fixture holidays)', () => {
  it('skips Zambian Africa Freedom Day (Monday 25 May 2026): Friday 22 May plus 1 is Tuesday 26', () => {
    expect(addBusinessDays(sast('2026-05-22T10:00:00'), 1, 'ZM', calendar)).toEqual(
      sast('2026-05-26T10:00:00'),
    );
  });

  it('differs from ZA where the holidays differ: 9 March 2026 is a Zambian holiday only', () => {
    expect(addBusinessDays(sast('2026-03-06T10:00:00'), 1, 'ZA', calendar)).toEqual(
      sast('2026-03-09T10:00:00'),
    );
    expect(addBusinessDays(sast('2026-03-06T10:00:00'), 1, 'ZM', calendar)).toEqual(
      sast('2026-03-10T10:00:00'),
    );
  });
});

describe('isBusinessDay', () => {
  it('is false for a weekend and for a public holiday, true for an ordinary weekday', () => {
    expect(isBusinessDay('2026-09-26', 'ZA', calendar)).toBe(false);
    expect(isBusinessDay('2026-09-24', 'ZA', calendar)).toBe(false);
    expect(isBusinessDay('2026-09-25', 'ZA', calendar)).toBe(true);
  });

  it('refuses a malformed date, and a year with no holiday data', () => {
    expect(() => isBusinessDay('2026-9-24', 'ZA', calendar)).toThrow(RangeError);
    expect(() => isBusinessDay('2027-01-04', 'ZA', calendar)).toThrow(CalendarCoverageError);
  });
});
