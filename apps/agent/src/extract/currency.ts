import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../../../../packages/shared/src/money/minor-units.js';

/**
 * Currencies named in a quote. An ISO code is read as written. A symbol is read only where it is unambiguous: "R"
 * before a digit is South African rand, "US$" is US dollars, and "€" and "£" are euro and pound. A bare "$" is not
 * read at all, because it could mean several currencies, so the invoice would then be held.
 */

const ISO_CODE = /\b(ZAR|USD|EUR|GBP)\b/g;
// Without the global flag, so that test() keeps no state between calls.
const RAND_SYMBOL = /(?<![A-Za-z])R(?=\s?\d)/;

function isSupported(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** The distinct currencies a quote names, in first-seen order. */
export function currenciesIn(text: string): SupportedCurrency[] {
  const found: string[] = [];
  for (const match of text.matchAll(ISO_CODE)) {
    found.push(match[1] ?? '');
  }
  if (RAND_SYMBOL.test(text)) {
    found.push('ZAR');
  }
  if (text.includes('US$')) {
    found.push('USD');
  }
  if (text.includes('€')) {
    found.push('EUR');
  }
  if (text.includes('£')) {
    found.push('GBP');
  }
  const distinct: SupportedCurrency[] = [];
  for (const code of found) {
    if (isSupported(code) && !distinct.includes(code)) {
      distinct.push(code);
    }
  }
  return distinct;
}
