// Business-day arithmetic for cooling-off periods (B9). Pure: the holiday data is passed in, never read here.

/** Countries with holiday data. Both use a Saturday and Sunday weekend and a fixed UTC+2 offset. */
export type CalendarCountry = 'ZA' | 'ZM';

/** The offset of South Africa (SAST) and Zambia (CAT). Neither observes daylight saving. */
export const LOCAL_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The holiday dates for one country: the years they cover and each holiday as YYYY-MM-DD. */
export interface CountryHolidays {
  readonly years: readonly number[];
  readonly dates: ReadonlySet<string>;
}

/** Holiday data for every supported country, with its provenance. */
export interface HolidayCalendar {
  /** Human-readable origin, shown wherever a cooling-off end is shown. */
  readonly source: string;
  readonly sourceKind: 'live' | 'fixture';
  /** Why a live request was replaced by the fixture, or null when no fallback happened. */
  readonly fallbackReason: string | null;
  readonly countries: Readonly<Record<CalendarCountry, CountryHolidays>>;
}

/** Thrown when a date falls in a year with no holiday data. The caller must hold, not guess. */
export class CalendarCoverageError extends RangeError {
  constructor(country: CalendarCountry, date: string) {
    super(`no ${country} holiday data for ${date}; the cooling-off end cannot be computed`);
    this.name = 'CalendarCoverageError';
  }
}

const DATE_TEXT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** The local calendar date (YYYY-MM-DD) of a day index counted from 1970-01-01 in local time. */
function dateOfDayIndex(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

/** The holiday data for one supported country. Explicit cases, so no computed property lookup. */
export function countryHolidays(
  calendar: HolidayCalendar,
  country: CalendarCountry,
): CountryHolidays {
  switch (country) {
    case 'ZA':
      return calendar.countries.ZA;
    case 'ZM':
      return calendar.countries.ZM;
  }
}

/** True for Saturday or Sunday, from a day index where 0 is Thursday 1970-01-01. */
function isWeekend(dayIndex: number): boolean {
  const weekday = (((dayIndex + 4) % 7) + 7) % 7; // 0 = Sunday ... 6 = Saturday
  return weekday === 0 || weekday === 6;
}

/**
 * Adds a number of business days to a timestamp, in the country's local time. Counting starts the
 * day after the start, so a start on a weekend or a holiday counts from the next working day. A
 * result keeps the start's local time of day. Zero days returns the start unchanged.
 *
 * Example: Wednesday 23 September 2026 at 10:00 SAST plus 3 business days. Thursday 24 September is
 * Heritage Day and is skipped, so the days are Friday 25, Monday 28 and Tuesday 29: the end is
 * Tuesday 29 September 2026 at 10:00 SAST.
 */
export function addBusinessDays(
  start: Date,
  businessDays: number,
  country: CalendarCountry,
  calendar: HolidayCalendar,
): Date {
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) {
    throw new RangeError('business days must be a whole number, zero or more');
  }
  if (Number.isNaN(start.getTime())) {
    throw new RangeError('start must be a valid date');
  }
  if (businessDays === 0) return new Date(start.getTime());

  const holidays = countryHolidays(calendar, country);
  const localMs = start.getTime() + LOCAL_OFFSET_MS;
  const startDayIndex = Math.floor(localMs / DAY_MS);
  const timeOfDayMs = localMs - startDayIndex * DAY_MS;

  let dayIndex = startDayIndex;
  let counted = 0;
  while (counted < businessDays) {
    dayIndex += 1;
    const date = dateOfDayIndex(dayIndex);
    const year = Number(date.slice(0, 4));
    if (!holidays.years.includes(year)) {
      throw new CalendarCoverageError(country, date);
    }
    if (!isWeekend(dayIndex) && !holidays.dates.has(date)) {
      counted += 1;
    }
  }

  return new Date(dayIndex * DAY_MS + timeOfDayMs - LOCAL_OFFSET_MS);
}

/** True when a YYYY-MM-DD date is a business day for the country. Throws outside the covered years. */
export function isBusinessDay(
  date: string,
  country: CalendarCountry,
  calendar: HolidayCalendar,
): boolean {
  if (!DATE_TEXT.test(date)) {
    throw new RangeError('date must be YYYY-MM-DD');
  }
  const holidays = countryHolidays(calendar, country);
  if (!holidays.years.includes(Number(date.slice(0, 4)))) {
    throw new CalendarCoverageError(country, date);
  }
  const dayIndex = Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  return !isWeekend(dayIndex) && !holidays.dates.has(date);
}
