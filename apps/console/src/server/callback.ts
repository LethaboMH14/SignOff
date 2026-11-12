/**
 * The supplier bank-change call-back record and its cooling-off end (Lane E item 3).
 *
 * A changed bank account is held until an operator has phoned the supplier on a number from the MASTER record (never a
 * number in the invoice or the change request), and the cooling-off period has passed. The cooling-off counts business
 * days with the calendar module. Fail closed: a missing calendar, a fixture calendar in a control path, or a year with
 * no holiday data is a hold, never a guessed date.
 */
import {
  CalendarCoverageError,
  type HolidayCalendar,
  addBusinessDays,
  type CalendarCountry,
} from '../../../../packages/shared/src/calendar/index.js';

export interface CallbackInput {
  /** The operator who made the call. */
  readonly operatorId: string;
  /** The name and role of the person the operator spoke to at the supplier. */
  readonly spokeTo: string;
  /** The number the operator dialled, as typed. Must match the master record. */
  readonly dialled: string;
  /** When the call was made (ISO 8601). */
  readonly calledAt: string;
  /** Whether the supplier confirmed the change on the call. */
  readonly confirmed: boolean;
}

export interface CallbackRecord extends CallbackInput {
  /** The master-record number the call was checked against, digits only. */
  readonly masterDigits: string;
}

export type CallbackOutcome =
  | { readonly ok: true; readonly record: CallbackRecord }
  | { readonly ok: false; readonly code: 'NUMBER_NOT_ON_MASTER' | 'NOT_CONFIRMED' | 'BAD_INPUT'; readonly message: string };

/** Digits only, so "+27 11 555 0100" and "0115550100" compare equal after the country prefix is normalised. */
export function digitsOf(text: string): string {
  const digits = text.replace(/\D/g, '');
  // A South African mobile or landline written with the +27 country code is the same number as the 0-prefixed form.
  return digits.startsWith('27') && digits.length === 11 ? `0${digits.slice(2)}` : digits;
}

/**
 * Records a call-back. The dialled number must be the one on the master record; a number from the invoice or the change
 * request does not count, so such a call is refused and the payment stays held.
 */
export function recordCallback(
  input: CallbackInput,
  masterNumber: string,
): CallbackOutcome {
  if (input.operatorId.trim() === '' || input.spokeTo.trim() === '') {
    return { ok: false, code: 'BAD_INPUT', message: 'the operator and the person spoken to are both required' };
  }
  if (Number.isNaN(Date.parse(input.calledAt))) {
    return { ok: false, code: 'BAD_INPUT', message: 'the call time must be a valid date' };
  }
  const masterDigits = digitsOf(masterNumber);
  if (masterDigits.length < 7 || digitsOf(input.dialled) !== masterDigits) {
    return {
      ok: false,
      code: 'NUMBER_NOT_ON_MASTER',
      message: 'the number dialled is not the number on the master record; the change stays held',
    };
  }
  if (!input.confirmed) {
    return { ok: false, code: 'NOT_CONFIRMED', message: 'the supplier did not confirm the change; the change stays held' };
  }
  return { ok: true, record: { ...input, masterDigits } };
}

export type CoolingOff =
  | { readonly status: 'ends'; readonly endsAt: string; readonly source: string }
  | { readonly status: 'hold'; readonly reason: string };

/**
 * The end of a cooling-off period of `businessDays` after the confirmed call. Returns a hold, never a guess, when the
 * calendar is missing, is a fixture (fixtures are not allowed in a control path), or does not cover the year.
 */
export function coolingOffEnd(
  confirmedAt: Date,
  businessDays: number,
  country: CalendarCountry,
  calendar: HolidayCalendar | null,
): CoolingOff {
  if (calendar === null) {
    return { status: 'hold', reason: 'the holiday calendar is unavailable; the cooling-off end cannot be computed' };
  }
  if (calendar.sourceKind !== 'live') {
    return { status: 'hold', reason: 'the holiday data is a fixture, which is not used for a payment decision' };
  }
  try {
    const end = addBusinessDays(confirmedAt, businessDays, country, calendar);
    return { status: 'ends', endsAt: end.toISOString(), source: calendar.source };
  } catch (error) {
    if (error instanceof CalendarCoverageError) {
      return { status: 'hold', reason: error.message };
    }
    throw error;
  }
}
