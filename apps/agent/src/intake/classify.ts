import { normaliseText } from '../text/normalise.js';

/**
 * The document classifier. The agent pays only a ZAR tax invoice. Anything else is held with a reason code, and an
 * unknown document is held as well: the default is to hold. The rules read the text the parser or the OCR produced.
 */

export type DocumentClass = 'TAX_INVOICE' | 'CREDIT_NOTE' | 'PRO_FORMA' | 'STATEMENT' | 'UNKNOWN';

export type ClassifyHold =
  | 'CLASS_CREDIT_NOTE'
  | 'CLASS_PRO_FORMA'
  | 'CLASS_STATEMENT'
  | 'CLASS_UNKNOWN'
  | 'CURRENCY_NON_ZAR'
  | 'CURRENCY_NOT_STATED'
  | 'MULTIPLE_INVOICE_NUMBERS';

export interface ClassifyResult {
  readonly documentClass: DocumentClass;
  /** Every reason the document is not a ZAR tax invoice. Empty when it is one. */
  readonly holds: readonly ClassifyHold[];
}

const ISO_CODES = /\b(ZAR|USD|EUR|GBP|AUD|CAD|CHF|JPY|CNY|INR|NGN|KES|BWP|NAD|ZMW|MZN|AED)\b/g;
const NON_ZAR_SYMBOLS = /[$€£¥]/;
const INVOICE_NUMBER = /\binvoice\s*(?:number|no\.?|#|nr\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/gi;

export function classifyDocument(pages: readonly string[]): ClassifyResult {
  const text = normaliseText(pages.join('\n'));
  const documentClass = classOf(text.toLowerCase());
  const holds: ClassifyHold[] = [];

  if (documentClass === 'CREDIT_NOTE') holds.push('CLASS_CREDIT_NOTE');
  if (documentClass === 'PRO_FORMA') holds.push('CLASS_PRO_FORMA');
  if (documentClass === 'STATEMENT') holds.push('CLASS_STATEMENT');
  if (documentClass === 'UNKNOWN') holds.push('CLASS_UNKNOWN');

  // Currency: any other ISO code or foreign symbol holds the document. A ZAR code must be stated somewhere.
  const codes = new Set([...text.matchAll(ISO_CODES)].map((match) => match[1] ?? ''));
  const nonZar = [...codes].some((code) => code !== 'ZAR') || NON_ZAR_SYMBOLS.test(text);
  if (nonZar) {
    holds.push('CURRENCY_NON_ZAR');
  } else if (!codes.has('ZAR')) {
    holds.push('CURRENCY_NOT_STATED');
  }

  const numbers = new Set(
    [...text.matchAll(INVOICE_NUMBER)].map((match) => (match[1] ?? '').toUpperCase()),
  );
  if (numbers.size > 1) {
    holds.push('MULTIPLE_INVOICE_NUMBERS');
  }

  return { documentClass, holds };
}

function classOf(lower: string): DocumentClass {
  if (/\bcredit\s+note\b|\bdebit\s+note\b/.test(lower)) return 'CREDIT_NOTE';
  if (/\bpro[\s-]?forma\b/.test(lower)) return 'PRO_FORMA';
  if (/\bstatement\s+of\s+account\b|\baccount\s+statement\b/.test(lower)) return 'STATEMENT';
  if (/\binvoice\b|\bfaktuur\b|\bfacture\b/.test(lower)) return 'TAX_INVOICE';
  return 'UNKNOWN';
}
