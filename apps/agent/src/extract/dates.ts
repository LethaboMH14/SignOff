/**
 * Dates that an invoice may print, read by code. The agent accepts these forms and nothing else. A date in a form
 * it does not know is ambiguous, so the invoice is held rather than guessed at.
 *
 * Numeric dates are read day first, the convention for South African invoices. A numeric date whose day and month
 * are both 12 or below is therefore read one way only. This is an assumption, and it is recorded in the decision
 * journal (D-062). A US-style date read as day first gives a different date, and the mismatch is held.
 */

const MONTHS: ReadonlyMap<string, number> = new Map<string, number>([
  ['jan', 1],
  ['january', 1],
  ['feb', 2],
  ['february', 2],
  ['mar', 3],
  ['march', 3],
  ['apr', 4],
  ['april', 4],
  ['may', 5],
  ['jun', 6],
  ['june', 6],
  ['jul', 7],
  ['july', 7],
  ['aug', 8],
  ['august', 8],
  ['sep', 9],
  ['sept', 9],
  ['september', 9],
  ['oct', 10],
  ['october', 10],
  ['nov', 11],
  ['november', 11],
  ['dec', 12],
  ['december', 12],
]);

const ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const DAY_FIRST = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/g;
const DAY_MONTH_NAME = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?!\d)/g;
const MONTH_NAME_DAY =
  /(?<![A-Za-z])([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/g;

/** The calendar date as YYYY-MM-DD, or null when the parts do not form a real date. */
function isoOf(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthOf(name: string): number | null {
  return MONTHS.get(name.toLowerCase()) ?? null;
}

/** Every date in the text that is in an accepted form and is a real calendar date, as YYYY-MM-DD. */
export function isoDatesIn(text: string): string[] {
  const found: string[] = [];
  const add = (iso: string | null): void => {
    if (iso !== null) {
      found.push(iso);
    }
  };
  for (const match of text.matchAll(ISO)) {
    add(isoOf(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of text.matchAll(DAY_FIRST)) {
    add(isoOf(Number(match[3]), Number(match[2]), Number(match[1])));
  }
  for (const match of text.matchAll(DAY_MONTH_NAME)) {
    const month = monthOf(match[2] ?? '');
    add(month === null ? null : isoOf(Number(match[3]), month, Number(match[1])));
  }
  for (const match of text.matchAll(MONTH_NAME_DAY)) {
    const month = monthOf(match[1] ?? '');
    add(month === null ? null : isoOf(Number(match[3]), month, Number(match[2])));
  }
  return found;
}
