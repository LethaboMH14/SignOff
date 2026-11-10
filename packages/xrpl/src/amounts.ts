import { IOU_MAX_SIGNIFICANT_DIGITS } from './constants.js';

/** An issued-currency amount (a token issued by an account). */
export interface IssuedAmount {
  readonly currency: string;
  readonly issuer: string;
  readonly value: string;
}

export class AmountError extends Error {
  constructor(reason: string) {
    super(`Amount refused: ${reason}`);
    this.name = 'AmountError';
  }
}

const DIGITS = /^[0-9]+$/;

function isDigits(text: string): boolean {
  return DIGITS.test(text);
}

/**
 * Canonical form of a plain, non-negative decimal: no leading zeros and no trailing fraction zeros.
 * Anything else (signs, exponents, separators, too many significant digits) is refused, never rounded.
 */
export function normaliseDecimal(value: string): string {
  const parts = value.split('.');
  if (parts.length > 2) {
    throw new AmountError('value is not a plain non-negative decimal');
  }
  const whole = parts[0] ?? '';
  const fraction = parts[1];
  if (!isDigits(whole) || (whole.length > 1 && whole.startsWith('0'))) {
    throw new AmountError('value is not a plain non-negative decimal');
  }
  if (fraction !== undefined && !isDigits(fraction)) {
    throw new AmountError('value is not a plain non-negative decimal');
  }
  const fractionCanonical = (fraction ?? '').replace(/0+$/, '');
  const significant = `${whole}${fractionCanonical}`.replace(/^0+/, '');
  if (significant.length > IOU_MAX_SIGNIFICANT_DIGITS) {
    throw new AmountError(`more than ${String(IOU_MAX_SIGNIFICANT_DIGITS)} significant digits`);
  }
  return fractionCanonical === '' ? whole : `${whole}.${fractionCanonical}`;
}

/** Returns the amount with a canonical value, or throws if it is zero or malformed. */
export function assertPositiveIou(amount: IssuedAmount): IssuedAmount {
  const value = normaliseDecimal(amount.value);
  if (value === '0') {
    throw new AmountError('amount must be greater than zero');
  }
  return { currency: amount.currency, issuer: amount.issuer, value };
}

/** True when two issued amounts are the same token and the same value. Malformed values are never equal. */
export function sameIouAmount(a: IssuedAmount, b: IssuedAmount): boolean {
  if (a.currency !== b.currency || a.issuer !== b.issuer) {
    return false;
  }
  try {
    return normaliseDecimal(a.value) === normaliseDecimal(b.value);
  } catch {
    return false;
  }
}

/** Compares two non-negative decimal strings numerically, without floating point. */
export function compareDecimal(a: string, b: string): number {
  const left = normaliseDecimal(a);
  const right = normaliseDecimal(b);
  const [aw = '0', af = ''] = left.split('.');
  const [bw = '0', bf = ''] = right.split('.');
  if (aw.length !== bw.length) {
    return aw.length < bw.length ? -1 : 1;
  }
  if (aw !== bw) {
    return aw < bw ? -1 : 1;
  }
  const width = Math.max(af.length, bf.length);
  const fa = af.padEnd(width, '0');
  const fb = bf.padEnd(width, '0');
  if (fa === fb) {
    return 0;
  }
  return fa < fb ? -1 : 1;
}
