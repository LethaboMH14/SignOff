import {
  parseMoneyText,
  type SupportedCurrency,
} from '../../../../packages/shared/src/money/minor-units.js';
import { sha256Hex } from '../../../../packages/shared/src/node.js';
import type { InvoiceExtraction } from '../../../../packages/shared/src/schemas/invoice.js';
import { normaliseText } from '../text/normalise.js';

import { currenciesIn } from './currency.js';
import { isoDatesIn } from './dates.js';

/**
 * Checks each field the model returned against the document, in code. A value counts as verified only when the quote
 * the model gave is found in the document, the value is in that quote, and the value means what the quote says. The
 * model never supplies an amount in numbers: the amount is text, parsed here under the money rules.
 *
 * A quote proves only that the text is in the document. It does not prove the document is true. That is why the match
 * step checks the values against records the document cannot write (see match/match.ts).
 */

export type FieldStatus = 'EXACT' | 'AMBIGUOUS' | 'MISSING' | 'CONFLICTING';

export type FieldReason =
  | 'FIELD_NOT_STATED'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_AMBIGUOUS'
  | 'VALUE_NOT_IN_QUOTE'
  | 'AMOUNT_FORMAT'
  | 'AMOUNT_NOT_PAYABLE'
  | 'AMOUNT_QUOTE_AMBIGUOUS'
  | 'CURRENCY_UNVERIFIED'
  | 'DATE_FORMAT'
  | 'DATE_AMBIGUOUS'
  | 'DATE_CONFLICT'
  | 'CURRENCY_NOT_STATED'
  | 'CURRENCY_AMBIGUOUS'
  | 'CURRENCY_CONFLICT';

export interface FieldEvidence<T> {
  readonly status: FieldStatus;
  /** Present only when the status is EXACT. */
  readonly value: T | null;
  readonly reason: FieldReason | null;
  /** The 1-based page the quote was found on, when it was found. */
  readonly page: number | null;
  /** SHA-256 of the normalised quote. The audit trail keeps this hash, not the quoted text. */
  readonly quoteSha256: string | null;
}

export interface PrintedTotal {
  /** The amount as printed, normalised for white space and without a currency. */
  readonly printed: string;
  readonly minor: number;
}

export interface VerifiedInvoice {
  readonly supplierName: FieldEvidence<string>;
  readonly invoiceNumber: FieldEvidence<string>;
  readonly invoiceDate: FieldEvidence<string>;
  readonly currency: FieldEvidence<SupportedCurrency>;
  readonly total: FieldEvidence<PrintedTotal>;
  readonly purchaseOrderNumber: FieldEvidence<string>;
  readonly payeeAccountAsPrinted: FieldEvidence<string>;
}

type Sourced<T> = { readonly value: T; readonly quote: string } | null;

interface Located {
  readonly page: number;
  readonly quote: string;
  readonly quoteSha256: string;
}

type Found =
  | { readonly ok: true; readonly at: Located }
  | { readonly ok: false; readonly reason: FieldReason };

function missing<T>(): FieldEvidence<T> {
  return {
    status: 'MISSING',
    value: null,
    reason: 'FIELD_NOT_STATED',
    page: null,
    quoteSha256: null,
  };
}

function ambiguousAt<T>(reason: FieldReason, at: Located | null): FieldEvidence<T> {
  return {
    status: 'AMBIGUOUS',
    value: null,
    reason,
    page: at?.page ?? null,
    quoteSha256: at?.quoteSha256 ?? null,
  };
}

function conflictingAt<T>(reason: FieldReason, at: Located): FieldEvidence<T> {
  return { status: 'CONFLICTING', value: null, reason, page: at.page, quoteSha256: at.quoteSha256 };
}

function exactAt<T>(value: T, at: Located): FieldEvidence<T> {
  return { status: 'EXACT', value, reason: null, page: at.page, quoteSha256: at.quoteSha256 };
}

function locate(quote: string, docPages: readonly string[]): Found {
  const needle = normaliseText(quote);
  if (needle.length === 0) {
    return { ok: false, reason: 'QUOTE_NOT_FOUND' };
  }
  const pagesWithQuote: number[] = [];
  docPages.forEach((page, index) => {
    if (page.includes(needle)) {
      pagesWithQuote.push(index + 1);
    }
  });
  const [page] = pagesWithQuote;
  if (page === undefined) {
    return { ok: false, reason: 'QUOTE_NOT_FOUND' };
  }
  if (pagesWithQuote.length > 1) {
    return { ok: false, reason: 'QUOTE_AMBIGUOUS' };
  }
  return { ok: true, at: { page, quote: needle, quoteSha256: sha256Hex(needle) } };
}

/** Text fields: the value must appear inside the quote that was found. */
function verifyContained(
  sourced: Sourced<string>,
  docPages: readonly string[],
): FieldEvidence<string> {
  if (sourced === null) {
    return missing();
  }
  const found = locate(sourced.quote, docPages);
  if (!found.ok) {
    return ambiguousAt(found.reason, null);
  }
  const value = normaliseText(sourced.value);
  if (value.length === 0 || !found.at.quote.includes(value)) {
    return ambiguousAt('VALUE_NOT_IN_QUOTE', found.at);
  }
  return exactAt(value, found.at);
}

function verifyDate(sourced: Sourced<string>, docPages: readonly string[]): FieldEvidence<string> {
  if (sourced === null) {
    return missing();
  }
  const found = locate(sourced.quote, docPages);
  if (!found.ok) {
    return ambiguousAt(found.reason, null);
  }
  const dates = [...new Set(isoDatesIn(found.at.quote))];
  const [only] = dates;
  if (only === undefined) {
    return ambiguousAt('DATE_FORMAT', found.at);
  }
  if (dates.length > 1) {
    return ambiguousAt('DATE_AMBIGUOUS', found.at);
  }
  if (only !== normaliseText(sourced.value)) {
    return conflictingAt('DATE_CONFLICT', found.at);
  }
  return exactAt(only, found.at);
}

function verifyCurrency(
  sourced: Sourced<SupportedCurrency>,
  docPages: readonly string[],
): FieldEvidence<SupportedCurrency> {
  if (sourced === null) {
    return missing();
  }
  const found = locate(sourced.quote, docPages);
  if (!found.ok) {
    return ambiguousAt(found.reason, null);
  }
  const named = currenciesIn(found.at.quote);
  const [only] = named;
  if (only === undefined) {
    return ambiguousAt('CURRENCY_NOT_STATED', found.at);
  }
  if (named.length > 1) {
    return ambiguousAt('CURRENCY_AMBIGUOUS', found.at);
  }
  if (only !== sourced.value) {
    return conflictingAt('CURRENCY_CONFLICT', found.at);
  }
  return exactAt(only, found.at);
}

/** The digit runs in the text. A quote that holds one amount has the same number of runs as the amount as printed. */
function amountPartsIn(text: string): number {
  return text.match(/\d+/g)?.length ?? 0;
}

function verifyTotal(
  sourced: Sourced<string>,
  docPages: readonly string[],
  currency: FieldEvidence<SupportedCurrency>,
): FieldEvidence<PrintedTotal> {
  if (sourced === null) {
    return missing();
  }
  const found = locate(sourced.quote, docPages);
  if (!found.ok) {
    return ambiguousAt(found.reason, null);
  }
  const printed = normaliseText(sourced.value);
  if (!found.at.quote.includes(printed)) {
    return ambiguousAt('VALUE_NOT_IN_QUOTE', found.at);
  }
  if (currency.status !== 'EXACT' || currency.value === null) {
    return ambiguousAt('CURRENCY_UNVERIFIED', found.at);
  }
  const parsed = parseMoneyText(printed, currency.value);
  if (!parsed.ok) {
    return ambiguousAt('AMOUNT_FORMAT', found.at);
  }
  if (parsed.minor < 1) {
    return ambiguousAt('AMOUNT_NOT_PAYABLE', found.at);
  }
  // The quote may hold one amount only. A second number, such as a VAT figure, could be the one that was meant.
  if (amountPartsIn(found.at.quote) !== amountPartsIn(printed)) {
    return ambiguousAt('AMOUNT_QUOTE_AMBIGUOUS', found.at);
  }
  return exactAt({ printed, minor: parsed.minor }, found.at);
}

/** Checks every field of an extraction against the document pages (already normalised for comparison). */
export function verifyInvoice(
  extraction: InvoiceExtraction,
  pages: readonly string[],
): VerifiedInvoice {
  const docPages = pages.map(normaliseText);
  const currency = verifyCurrency(extraction.currency, docPages);
  return {
    supplierName: verifyContained(extraction.supplierName, docPages),
    invoiceNumber: verifyContained(extraction.invoiceNumber, docPages),
    invoiceDate: verifyDate(extraction.invoiceDate, docPages),
    currency,
    total: verifyTotal(extraction.totalAsPrinted, docPages, currency),
    purchaseOrderNumber: verifyContained(extraction.purchaseOrderNumber, docPages),
    payeeAccountAsPrinted: verifyContained(extraction.payeeAccountAsPrinted, docPages),
  };
}

/**
 * The reasons an invoice cannot go forward, as "field:reason" strings. Every required field must be EXACT. The printed
 * account is optional, but if the invoice states one it must be verified, because it is compared with the enrolled
 * account. An empty list means the invoice may go on to matching.
 */
export function holdReasonsOf(verified: VerifiedInvoice): string[] {
  const required: readonly (readonly [string, FieldEvidence<unknown>])[] = [
    ['supplierName', verified.supplierName],
    ['invoiceNumber', verified.invoiceNumber],
    ['invoiceDate', verified.invoiceDate],
    ['currency', verified.currency],
    ['total', verified.total],
    ['purchaseOrderNumber', verified.purchaseOrderNumber],
  ];
  const reasons: string[] = [];
  for (const [field, evidence] of required) {
    if (evidence.status !== 'EXACT') {
      reasons.push(`${field}:${evidence.reason ?? evidence.status}`);
    }
  }
  const payee = verified.payeeAccountAsPrinted;
  if (payee.status === 'AMBIGUOUS' || payee.status === 'CONFLICTING') {
    reasons.push(`payeeAccountAsPrinted:${payee.reason ?? payee.status}`);
  }
  return reasons;
}
