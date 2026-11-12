// Integer-cent money. Nothing here uses floating point for an amount: VAT is exact or the
// subtotal is rejected (see vatMinor).

/** SARS: a full tax invoice is required when the price is more than R5 000 (R1, SARS page). */
export const FULL_INVOICE_ABOVE_MINOR = 500_000;
/** SARS: an abridged tax invoice may be issued at or below R5 000 (R1, SARS page). */
export const ABRIDGED_MAX_MINOR = 500_000;
/** South African VAT rate, 15% (VAT Act; rate stated in R1). */
export const VAT_PERCENT = 15;

/**
 * VAT in cents for a subtotal in cents. Throws unless the result is exact, so every generated
 * invoice satisfies subtotal + VAT = total with no rounding. A subtotal is exact when
 * subtotal * 15 / 100 is an integer, which needs subtotal % 20 === 0.
 */
export function vatMinor(subtotalMinor: number): number {
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0) {
    throw new RangeError(
      `subtotal must be a positive integer of cents, got ${String(subtotalMinor)}`,
    );
  }
  const scaled = subtotalMinor * VAT_PERCENT;
  if (scaled % 100 !== 0) {
    throw new RangeError(`subtotal ${String(subtotalMinor)} gives inexact VAT at 15%`);
  }
  return scaled / 100;
}

/** Smallest subtotal change that makes subtotal exact at 15% VAT. */
export function nearestExactSubtotal(subtotalMinor: number): number {
  return subtotalMinor + ((20 - (subtotalMinor % 20)) % 20);
}

/** Inserts a separator every three digits from the right, without a regular expression. */
function groupThousands(digits: string, separator: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits.charAt(i);
  }
  return out;
}

/**
 * Formats cents for a human reader. Two house styles: South African space-grouped with a decimal
 * comma ("R 12 345,67") and comma-grouped with a decimal point ("R12,345.67").
 */
export function formatAmount(
  minor: number,
  style: 'space-comma' | 'comma-dot',
  currency: string,
): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const digits = String(whole);
  if (style === 'space-comma') {
    const grouped = groupThousands(digits, ' ');
    const prefix = currency === 'ZAR' ? 'R ' : `${currency} `;
    return `${negative ? '-' : ''}${prefix}${grouped},${cents}`;
  }
  const grouped = groupThousands(digits, ',');
  const prefix = currency === 'ZAR' ? 'R' : `${currency} `;
  return `${negative ? '-' : ''}${prefix}${grouped}.${cents}`;
}

/** Formats an ISO date (YYYY-MM-DD) in one of the day-first styles South African invoices use. */
export function formatDate(iso: string, style: 'slash' | 'dash' | 'long'): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) throw new RangeError(`not an ISO date: ${iso}`);
  if (style === 'slash') return `${day}/${month}/${year}`;
  if (style === 'dash') return `${day}-${month}-${year}`;
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthName = names[Number(month) - 1];
  if (!monthName) throw new RangeError(`bad month in ${iso}`);
  return `${String(Number(day))} ${monthName} ${year}`;
}
