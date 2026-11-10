/**
 * Personal and financial identifiers that must not appear in logs. Each rule is checked more than
 * a shape where a check digit exists, so ordinary numbers are not redacted by accident. Where the
 * check is absent, the rule over-redacts on purpose: in a log, hiding a harmless value costs
 * nothing, and leaking a personal one costs a great deal.
 */

export type PiiKind = 'email' | 'iban' | 'national-id' | 'payment-card' | 'phone';

export interface PiiSpan {
  readonly kind: PiiKind;
  readonly start: number;
  readonly end: number;
}

/** True when a run of ASCII digits passes the Luhn check-digit algorithm. */
export function passesLuhn(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    const code = digits.charCodeAt(index);
    if (code < 48 || code > 57) return false;
    let digit = code - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * A South African identity number: thirteen digits, the first six a birth date (YYMMDD), and a final
 * Luhn check digit. The month and day ranges are checked, not the days in each month.
 */
export function isSouthAfricanIdNumber(digits: string): boolean {
  if (digits.length !== 13) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return passesLuhn(digits);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const DIGIT_RUN = /\b\d{13,19}\b/g;
const PHONE = /\+\d{8,15}\b/g;

/** Find personal and financial identifiers. Returns offsets only, never the values. */
export function findPii(text: string): PiiSpan[] {
  const spans: PiiSpan[] = [];

  for (const match of text.matchAll(EMAIL)) {
    spans.push({ kind: 'email', start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(IBAN)) {
    spans.push({ kind: 'iban', start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(PHONE)) {
    spans.push({ kind: 'phone', start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0];
    const start = match.index;
    const end = start + digits.length;
    if (digits.length === 13 && isSouthAfricanIdNumber(digits)) {
      spans.push({ kind: 'national-id', start, end });
    } else if (passesLuhn(digits)) {
      spans.push({ kind: 'payment-card', start, end });
    }
  }

  return spans;
}
