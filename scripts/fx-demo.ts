// Prints the simulated receipt payout (D4) and the business-day cooling-off table (B9).
// Offline by default: fixture rates and fixture holidays. Pass --live to try the public APIs once;
// any failure falls back to the fixture and says so. Every figure printed here is SIMULATED.

import {
  quoteRlusdPayoutInZar,
  resolveUsdZarRate,
  type SimulatedZarQuote,
} from '../packages/shared/src/fx/index.js';
import {
  addBusinessDays,
  countryHolidays,
  isBusinessDay,
  loadHolidayCalendar,
  LOCAL_OFFSET_MS,
  type CalendarCountry,
  type HolidayCalendar,
} from '../packages/shared/src/calendar/index.js';

const LIVE = process.argv.includes('--live');
const COOLING_OFF_BUSINESS_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A timestamp in South African time, e.g. "Wed 2026-09-23 10:00 SAST". */
function formatSast(instant: Date): string {
  const local = new Date(instant.getTime() + LOCAL_OFFSET_MS);
  const day = local.toISOString().slice(0, 10);
  const time = local.toISOString().slice(11, 16);
  return `${WEEKDAYS[local.getUTCDay()] ?? ''} ${day} ${time} SAST`;
}

function printReceipt(quote: SimulatedZarQuote): void {
  const rlusd = (quote.deliveredRlusdMinor / 100).toFixed(2);
  const lines = [
    `SIMULATED receipt payout quote (not a bank rate, not a settlement)`,
    `  Delivered:    ${rlusd} RLUSD`,
    `  Rate:         ${quote.rate} ZAR per USD (rate date ${quote.rateDate})`,
    `  Rand payout:  R${quote.zarText} (SIMULATED)`,
    `  Source:       ${quote.source}`,
    `  Assumption:   ${quote.assumption}`,
  ];
  if (quote.fallbackReason !== null) lines.push(`  Fallback:     ${quote.fallbackReason}`);
  console.log(lines.join('\n'));
  console.log('');
}

/** Counts the non-business days strictly after the start, up to and including the end, by reason. */
function skippedDays(
  start: Date,
  end: Date,
  country: CalendarCountry,
  calendar: HolidayCalendar,
): string {
  const first = Math.floor((start.getTime() + LOCAL_OFFSET_MS) / DAY_MS) + 1;
  const last = Math.floor((end.getTime() + LOCAL_OFFSET_MS) / DAY_MS);
  const names: string[] = [];
  for (let index = first; index <= last; index += 1) {
    const date = new Date(index * DAY_MS).toISOString().slice(0, 10);
    if (!isBusinessDay(date, country, calendar)) {
      const weekday = WEEKDAYS[new Date(index * DAY_MS).getUTCDay()] ?? '';
      const holiday = countryHolidays(calendar, country).dates.has(date);
      names.push(`${date} ${weekday}${holiday ? ' holiday' : ''}`);
    }
  }
  return names.length === 0 ? 'none' : names.join(', ');
}

async function main(): Promise<void> {
  const mode = LIVE ? 'live' : 'fixture';
  console.log(`SignOff FX and calendar demo (mode: ${mode}). All figures are SIMULATED.`);
  console.log('');

  // 1. Receipt blocks at the rate in use.
  const rate = await resolveUsdZarRate({ mode });
  console.log('1. Receipt payout (RLUSD to rand)');
  console.log(`   Rate source: ${rate.source}`);
  console.log('');
  for (const minor of [100, 1000]) {
    printReceipt(quoteRlusdPayoutInZar(minor, rate));
  }

  // 2. Cooling-off table on the holiday calendar in use.
  const calendar = await loadHolidayCalendar({ mode });
  console.log(
    `2. Cooling-off end for a ${String(COOLING_OFF_BUSINESS_DAYS)} business-day period (illustrative length; ZA)`,
  );
  console.log(`   Holiday source: ${calendar.source}`);
  console.log('');
  const starts = [
    '2026-09-18T10:00:00+02:00', // Friday, before a weekend
    '2026-09-23T10:00:00+02:00', // Wednesday, the day before Heritage Day
    '2026-09-24T10:00:00+02:00', // Thursday, Heritage Day itself
    '2026-12-11T10:00:00+02:00', // Friday, before a weekend and Day of Reconciliation
    '2026-12-23T16:30:00+02:00', // Wednesday before Christmas
  ];
  for (const text of starts) {
    const start = new Date(text);
    const byBusiness = addBusinessDays(start, COOLING_OFF_BUSINESS_DAYS, 'ZA', calendar);
    const byCalendar = new Date(start.getTime() + COOLING_OFF_BUSINESS_DAYS * DAY_MS);
    console.log(`  Start:              ${formatSast(start)}`);
    console.log(`  Ends (business):    ${formatSast(byBusiness)}`);
    console.log(
      `  Ends (calendar):    ${formatSast(byCalendar)}   <- what plain day counting would give`,
    );
    console.log(`  Skipped days:       ${skippedDays(start, byBusiness, 'ZA', calendar)}`);
    console.log('');
  }
}

await main();
