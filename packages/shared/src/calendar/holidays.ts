// Public holiday data for ZA and ZM. Fixture mode reads a committed capture of Nager.Date (2026).
// Live mode asks the public Nager.Date API (no key) once per country and year. Any failure falls back to
// the fixture, and the fallback is recorded on the calendar, so it is never silent.

import { z } from 'zod';

import type { CalendarCountry, CountryHolidays, HolidayCalendar } from './business-days.js';
import holidayFixture from './fixtures/public-holidays-2026.json' with { type: 'json' };

export const NAGER_BASE_URL = 'https://date.nager.at/api/v3/PublicHolidays' as const;
/** The years live mode asks for. The fixture covers the same years. */
export const LIVE_YEARS: readonly number[] = [2026];

export const CALENDAR_SOURCE_LIVE = 'Nager.Date public holidays API (date.nager.at), live request';
export const CALENDAR_SOURCE_FIXTURE =
  'Nager.Date public holidays, 2026, captured 2026-11-12 (committed fixture, not a live request)';

const DATE_TEXT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const NagerHoliday = z.object({ date: z.string().regex(DATE_TEXT), name: z.string() });
const NagerYear = z.array(NagerHoliday);

const FixtureFile = z.object({
  countries: z.object({
    ZA: z.record(z.string(), NagerYear),
    ZM: z.record(z.string(), NagerYear),
  }),
});

/** Holiday dates per country, keyed by year. Each country must be present, or the lookup fails closed. */
type YearLists = ReadonlyMap<number, readonly string[]>;
interface CountryLists {
  readonly ZA: YearLists;
  readonly ZM: YearLists;
}

/** One country's holidays from its year lists: the years covered and every date in them. */
function countryOf(lists: YearLists): CountryHolidays {
  const dates = new Set<string>();
  for (const list of lists.values()) {
    for (const date of list) dates.add(date);
  }
  return { years: [...lists.keys()].sort((a, b) => a - b), dates };
}

/** Builds a calendar from both countries' year lists. */
function buildCalendar(
  lists: CountryLists,
  origin: {
    readonly source: string;
    readonly sourceKind: 'live' | 'fixture';
    readonly fallbackReason: string | null;
  },
): HolidayCalendar {
  return {
    ...origin,
    countries: { ZA: countryOf(lists.ZA), ZM: countryOf(lists.ZM) },
  };
}

/** Turns a record of year to Nager holiday list into the year lists the calendar uses. */
function yearListsOf(record: Readonly<Record<string, z.infer<typeof NagerYear>>>): YearLists {
  const map = new Map<number, string[]>();
  for (const [year, holidays] of Object.entries(record)) {
    map.set(
      Number(year),
      holidays.map((holiday) => holiday.date),
    );
  }
  return map;
}

/** The committed fixture as a calendar. Throws if the file does not match its schema. */
export function fixtureHolidayCalendar(): HolidayCalendar {
  const parsed = FixtureFile.parse(holidayFixture);
  return buildCalendar(
    {
      ZA: yearListsOf(parsed.countries.ZA),
      ZM: yearListsOf(parsed.countries.ZM),
    },
    {
      source: CALENDAR_SOURCE_FIXTURE,
      sourceKind: 'fixture',
      fallbackReason: null,
    },
  );
}

/** Describes a thrown value in one plain phrase for the calendar's record. */
function reasonOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timed out';
  if (error instanceof z.ZodError) return 'unexpected response shape';
  if (error instanceof SyntaxError) return 'response was not JSON';
  if (error instanceof Error && error.message.startsWith('HTTP ')) return error.message;
  return 'network request failed';
}

export interface LoadCalendarOptions {
  /** Defaults to 'fixture'. Live mode is opt-in. */
  readonly mode?: 'fixture' | 'live';
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Per-request time limit in milliseconds. Defaults to 5000. */
  readonly timeoutMs?: number;
}

/** Asks Nager.Date for one country and year, and reads the list of holidays. */
async function fetchYear(
  fetchImpl: typeof fetch,
  country: CalendarCountry,
  year: number,
  timeoutMs: number,
): Promise<readonly string[]> {
  const response = await fetchImpl(`${NAGER_BASE_URL}/${String(year)}/${country}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const holidays = NagerYear.parse(await response.json());
  return holidays.map((holiday) => holiday.date);
}

/**
 * Loads holiday data. Live mode asks Nager.Date for each supported country and each live year. If any
 * request fails, the whole calendar comes from the fixture and `fallbackReason` says why.
 */
export async function loadHolidayCalendar(
  options: LoadCalendarOptions = {},
): Promise<HolidayCalendar> {
  if ((options.mode ?? 'fixture') === 'fixture') {
    return fixtureHolidayCalendar();
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  try {
    const za = new Map<number, readonly string[]>();
    const zm = new Map<number, readonly string[]>();
    for (const year of LIVE_YEARS) {
      za.set(year, await fetchYear(fetchImpl, 'ZA', year, timeoutMs));
      zm.set(year, await fetchYear(fetchImpl, 'ZM', year, timeoutMs));
    }
    return buildCalendar(
      { ZA: za, ZM: zm },
      { source: CALENDAR_SOURCE_LIVE, sourceKind: 'live', fallbackReason: null },
    );
  } catch (error: unknown) {
    const reason = reasonOf(error);
    return {
      ...fixtureHolidayCalendar(),
      source: `${CALENDAR_SOURCE_FIXTURE}. FALLBACK: live Nager.Date request failed (${reason})`,
      fallbackReason: `live request failed (${reason}); fixture used`,
    };
  }
}
