/**
 * Reads an amount as printed on an invoice, in code, into one canonical decimal string. Every form the agent accepts is
 * listed here, and every other form is ambiguous and is refused, so the invoice is held rather than guessed at.
 *
 * Accepted: plain digits ("1234.50", "1234"); dot decimal with comma thousands ("1,234.50"); comma decimal with dot
 * thousands ("1.234,50"); comma decimal alone ("1234,50"); space-grouped thousands in groups of three, with a comma or
 * dot decimal ("12 500,50", "12 500.50"); and a currency code or symbol around the amount (ZAR, R, US$, €, £, USD,
 * EUR, GBP).
 *
 * Refused as ambiguous: a comma or dot followed by exactly three digits with no other separator ("1,234", "1.234"),
 * because it may be thousands or decimals depending on the country; any sign; more than two decimal places; mixed
 * groupings. The currency rules and the money rules (money/minor-units.ts) then apply to the canonical value.
 *
 * Any white space may group thousands, including a no-break space and a narrow no-break space, which are
 * common on printed invoices.
 */

export type AmountReading =
  | { readonly ok: true; readonly canonical: string }
  | { readonly ok: false; readonly reason: 'AMOUNT_FORMAT' | 'AMOUNT_AMBIGUOUS' };

const SPACE_CLASS = /\s/;
const SPACE_GLOBAL = /\s/g;
const CURRENCY_BEFORE = /^(?:ZAR|USD|EUR|GBP|US\$|R(?=\s?\d)|€|£)\s*/;
const CURRENCY_AFTER = /\s*(?:ZAR|USD|EUR|GBP)$/;
const ALLOWED_CHARACTERS = /^[\d.,\s]+$/;

/** A candidate amount inside a quote: a run of digits that may hold spaces, dots or commas, ending in a digit. */
const AMOUNT_TOKEN = /\d[\d.,\s]*\d|\d/g;

/** Reads one amount text into its canonical form, or says why it cannot. */
export function canonicalAmount(text: string): AmountReading {
  let work = text.normalize('NFC').trim();
  work = work.replace(CURRENCY_BEFORE, '').replace(CURRENCY_AFTER, '').trim();
  if (work.length === 0 || !ALLOWED_CHARACTERS.test(work) || !/\d/.test(work)) {
    return { ok: false, reason: 'AMOUNT_FORMAT' };
  }
  if (SPACE_CLASS.test(work)) {
    // Spaces are allowed only as thousands grouping: a first group of one to three digits, then groups of three. The
    // last group may carry a decimal part of one or two digits.
    const groups = work.split(SPACE_CLASS);
    const last = groups.length - 1;
    const grouped = groups.every((group, index) => {
      if (index === 0) return /^\d{1,3}$/.test(group);
      if (index === last) return lastGroupOk(group);
      return /^\d{3}$/.test(group);
    });
    if (!grouped) {
      return { ok: false, reason: 'AMOUNT_FORMAT' };
    }
    work = work.replace(SPACE_GLOBAL, '');
  }
  return canonicalOf(work);
}

/** The last group of a grouped amount: three digits, then an optional decimal part of one or two digits. */
function lastGroupOk(group: string): boolean {
  const pieces = group.split(/[.,]/);
  const [digits = '', decimals] = pieces;
  return (
    pieces.length <= 2 &&
    /^\d{3}$/.test(digits) &&
    (decimals === undefined || /^\d{1,2}$/.test(decimals))
  );
}

function canonicalOf(work: string): AmountReading {
  const hasDot = work.includes('.');
  const hasComma = work.includes(',');
  if (!hasDot && !hasComma) {
    return { ok: true, canonical: work };
  }
  if (hasDot && hasComma) {
    // The last separator is the decimal mark; the other must be thousands grouping of three.
    const decimalAt = Math.max(work.lastIndexOf('.'), work.lastIndexOf(','));
    const decimalMark = work.charAt(decimalAt);
    const whole = work.slice(0, decimalAt);
    const fraction = work.slice(decimalAt + 1);
    const grouping = decimalMark === '.' ? ',' : '.';
    const wholeOk = whole.includes(grouping) ? isGroupedBy3(whole, grouping) : /^\d+$/.test(whole);
    if (!wholeOk || whole.includes(decimalMark)) {
      return { ok: false, reason: 'AMOUNT_FORMAT' };
    }
    if (!/^\d{1,2}$/.test(fraction)) {
      return { ok: false, reason: 'AMOUNT_AMBIGUOUS' };
    }
    return { ok: true, canonical: `${whole.split(grouping).join('')}.${fraction}` };
  }
  const mark = hasDot ? '.' : ',';
  const parts = work.split(mark);
  if (parts.length > 2) {
    // Several of one separator: thousands grouping only, so there is no decimal part.
    if (parts.slice(1).every((part) => part.length === 3) && /^\d{1,3}$/.test(parts[0] ?? '')) {
      return { ok: true, canonical: parts.join('') };
    }
    return { ok: false, reason: 'AMOUNT_FORMAT' };
  }
  const [whole = '', fraction = ''] = parts;
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) {
    return { ok: false, reason: 'AMOUNT_FORMAT' };
  }
  if (fraction.length === 3) {
    // "1,234" and "1.234" may be thousands or decimals, depending on the country. Never guessed.
    return { ok: false, reason: 'AMOUNT_AMBIGUOUS' };
  }
  if (fraction.length > 2) {
    return { ok: false, reason: 'AMOUNT_FORMAT' };
  }
  return { ok: true, canonical: `${whole}.${fraction}` };
}

function isGroupedBy3(whole: string, grouping: string): boolean {
  const [first = '', ...rest] = whole.split(grouping);
  return /^\d{1,3}$/.test(first) && rest.every((part) => part.length === 3 && /^\d{3}$/.test(part));
}

/**
 * Every candidate amount in a quote, as it is written there, in order. A figure followed by a percent sign is a rate,
 * such as the 15 in "VAT 15%", and is not an amount, so it is left out.
 */
export function amountTokensIn(quote: string): string[] {
  const text = quote.normalize('NFC');
  const found: string[] = [];
  for (const match of text.matchAll(AMOUNT_TOKEN)) {
    const after = text.slice(match.index + match[0].length).trimStart();
    if (!after.startsWith('%')) {
      found.push(match[0]);
    }
  }
  return found;
}
