import { normaliseText } from './normalise.js';

/**
 * The second reading of a scanned invoice's total. The model reads the OCR text and proposes a total; this module reads
 * the same OCR text with fixed rules and no model. The two must agree, in minor units, or the invoice is held. If no
 * labelled total is found at all, the invoice is held too: the default is to hold.
 */

export type ScanAmountHold = 'SCAN_AMOUNT_NOT_FOUND' | 'SCAN_AMOUNT_DISAGREES';

/**
 * A labelled total, with its decimal part. The label must start a word, so "Subtotal" is not read as "total". The
 * amount may carry spaces as thousands marks, including the no-break space that printers use (\xa0).
 */
const TOTAL_LABEL =
  /\b(?:grand\s+total|total\s+due|amount\s+due|total\s+amount|balance\s+due|total|totaal|totale|bedrag)\b[ \t]*[:.]?[ \t]*(?:ZAR|R)?[ \t]*([0-9][0-9 \xa0,.]*[.,][0-9]{2})(?![0-9])/gi;

/**
 * Every labelled total in the text, in minor units (cents), sorted and without duplicates. The number is read as the
 * last separator followed by two digits being the decimal point; any other separator is a thousands mark.
 */
export function totalsInText(text: string): number[] {
  const found = new Set<number>();
  for (const match of normaliseText(text).matchAll(TOTAL_LABEL)) {
    const minor = minorOf(match[1] ?? '');
    if (minor !== null) {
      found.add(minor);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Converts a printed amount with a two-digit decimal part to minor units, or null when it is not one. */
export function minorOf(printed: string): number | null {
  const compact = printed.replace(/[ \xa0]/g, '');
  const decimal = /^(.*)[.,](\d{2})$/.exec(compact);
  if (decimal === null) {
    return null;
  }
  const whole = (decimal[1] ?? '').replace(/[.,]/g, '');
  if (whole.length === 0 || whole.length > 12) {
    return null;
  }
  return Number(whole) * 100 + Number(decimal[2]);
}

/**
 * The hold for a scanned invoice whose verified total the second reading does not confirm, or null when it is confirmed.
 * The comparison is exact: one cent apart is a disagreement.
 */
export function scanAmountHold(ocrText: string, verifiedTotalMinor: number): ScanAmountHold | null {
  const totals = totalsInText(ocrText);
  if (totals.length === 0) {
    return 'SCAN_AMOUNT_NOT_FOUND';
  }
  return totals.includes(verifiedTotalMinor) ? null : 'SCAN_AMOUNT_DISAGREES';
}
