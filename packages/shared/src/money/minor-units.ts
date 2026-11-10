/**
 * Money as integers in minor units (cents). No amount is ever stored or computed as a floating-point
 * number. Amounts arrive as text, and that text is parsed with a strict grammar: anything ambiguous
 * is rejected, never guessed. A held invoice costs a person a minute; a wrong amount costs money.
 */

export const SUPPORTED_CURRENCIES = ['ZAR', 'USD', 'ZMW', 'EUR', 'GBP'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * The largest amount in minor units. It keeps every sum of two amounts exact in a JavaScript number
 * (2 x 10^15 is well below 2^53), and it is far above any single supplier invoice.
 */
export const MAX_MINOR_UNITS = 1_000_000_000_000_000;

const EXPONENTS: ReadonlyMap<SupportedCurrency, number> = new Map<SupportedCurrency, number>([
  ['ZAR', 2],
  ['USD', 2],
  ['ZMW', 2],
  ['EUR', 2],
  ['GBP', 2],
]);

/** Digits after the decimal point for a currency. */
export function minorUnitExponent(currency: SupportedCurrency): number {
  const exponent = EXPONENTS.get(currency);
  if (exponent === undefined) {
    throw new RangeError('unsupported currency');
  }
  return exponent;
}

export type MoneyParseResult =
  { readonly ok: true; readonly minor: number } | { readonly ok: false; readonly reason: string };

const NOT_A_PLAIN_AMOUNT =
  'not a plain amount: use digits, optional comma thousands and a dot decimal';

/** True for a non-empty run of ASCII digits 0 to 9 only. */
function isAsciiDigits(text: string): boolean {
  if (text.length === 0) return false;
  for (const character of text) {
    if (character < '0' || character > '9') return false;
  }
  return true;
}

/**
 * The integer part of an amount: plain digits, or digits grouped in threes with commas (the first
 * group may have one to three digits). Decimal commas are not accepted, so "12,50" is rejected.
 */
function isWholePart(text: string): boolean {
  const groups = text.split(',');
  if (groups.length === 1) return isAsciiDigits(text);
  const [first = '', ...rest] = groups;
  return (
    first.length >= 1 &&
    first.length <= 3 &&
    isAsciiDigits(first) &&
    rest.every((group) => group.length === 3 && isAsciiDigits(group))
  );
}

/**
 * Parse an amount as printed on an invoice into minor units. Accepts digits with an optional dot
 * decimal, or with comma thousands separators. Rejects spaces, currency symbols, signs, exponent
 * notation, decimal commas, and more decimal places than the currency has, because rounding is
 * exactly the kind of silent error this module exists to prevent.
 */
export function parseMoneyText(text: string, currency: SupportedCurrency): MoneyParseResult {
  const parts = text.trim().split('.');
  if (parts.length > 2) return { ok: false, reason: NOT_A_PLAIN_AMOUNT };

  const [whole = '', fraction] = parts;
  if (!isWholePart(whole)) return { ok: false, reason: NOT_A_PLAIN_AMOUNT };
  if (fraction !== undefined && !isAsciiDigits(fraction)) {
    return { ok: false, reason: NOT_A_PLAIN_AMOUNT };
  }

  const exponent = minorUnitExponent(currency);
  const decimals = fraction ?? '';
  if (decimals.length > exponent) {
    return { ok: false, reason: `more than ${String(exponent)} decimal places for ${currency}` };
  }

  const digits = whole.replaceAll(',', '');
  const scaledFraction = decimals.padEnd(exponent, '0');
  const minor =
    BigInt(digits) * 10n ** BigInt(exponent) +
    (scaledFraction === '' ? 0n : BigInt(scaledFraction));
  if (minor > BigInt(MAX_MINOR_UNITS)) {
    return { ok: false, reason: 'amount exceeds the supported maximum' };
  }
  return { ok: true, minor: Number(minor) };
}

/** Throws unless the value is a safe, non-negative integer within the supported range. */
export function assertMinorUnits(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR_UNITS) {
    throw new RangeError('amount must be a whole number of minor units within the supported range');
  }
}

/** The amount as a plain decimal string with no grouping, e.g. "12500.50". Used for ledger values. */
export function minorToDecimal(minor: number, currency: SupportedCurrency): string {
  assertMinorUnits(minor);
  const exponent = minorUnitExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const value = BigInt(minor);
  const whole = (value / scale).toString();
  if (exponent === 0) return whole;
  return `${whole}.${(value % scale).toString().padStart(exponent, '0')}`;
}

/** The amount for people to read, e.g. "12,500.50". */
export function formatMinor(minor: number, currency: SupportedCurrency): string {
  const decimal = minorToDecimal(minor, currency);
  const [whole = '', fraction] = decimal.split('.');
  const groups: string[] = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groups.unshift(whole.slice(Math.max(0, end - 3), end));
  }
  return fraction === undefined ? groups.join(',') : `${groups.join(',')}.${fraction}`;
}
