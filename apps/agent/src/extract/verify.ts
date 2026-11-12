import {
  parseMoneyText,
  type SupportedCurrency,
} from '../../../../packages/shared/src/money/minor-units.js';
import { sha256Hex } from '../../../../packages/shared/src/node.js';
import type { InvoiceExtraction } from '../../../../packages/shared/src/schemas/invoice.js';
import { normaliseText } from '../text/normalise.js';

import { amountTokensIn, canonicalAmount } from './amount.js';
import { currenciesIn } from './currency.js';
import { isoDatesIn } from './dates.js';

/**
 * Checks each field the model returned against the document, in code. A value counts as verified only when the quote
 * the model gave is found in the document, the value is in that quote, and the value means what the quote says. The
 * model never supplies an amount in numbers: the amount is text, read here under the money rules (see amount.ts).
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
  | 'AMOUNT_AMBIGUOUS'
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
  /** The amount as printed in the quote, normalised for white space and without a currency. */
  readonly printed: string;
  /** The canonical decimal string, for example "1234.50". */
  readonly canonical: string;
  readonly minor: number;
}

/**
 * Whether the stated amounts add up. "NOT_STATED": the invoice shows no subtotal and no VAT, so there is nothing to
 * check. "RECONCILED": subtotal plus VAT equals the total, or the subtotal equals the total with no VAT line. Every
 * other status holds the invoice, with its reason.
 */
export interface Reconciliation {
  readonly status: 'NOT_STATED' | 'RECONCILED' | 'NOT_RECONCILED' | 'INCOMPLETE' | 'UNVERIFIED';
  readonly reason: string | null;
}

export interface VerifiedInvoice {
  readonly supplierName: FieldEvidence<string>;
  readonly invoiceNumber: FieldEvidence<string>;
  readonly invoiceDate: FieldEvidence<string>;
  readonly currency: FieldEvidence<SupportedCurrency>;
  readonly total: FieldEvidence<PrintedTotal>;
  readonly purchaseOrderNumber: FieldEvidence<string>;
  readonly payeeAccountAsPrinted: FieldEvidence<string>;
  readonly reconciliation: Reconciliation;
}

type Sourced<T> = { readonly value: T; readonly quote: string } | null;

/** The optional amounts the reply may carry for the VAT check. Absent means not stated. */
export interface StatedAmounts {
  readonly subtotalAsPrinted?: Sourced<string>;
  readonly vatAsPrinted?: Sourced<string>;
}

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

/**
 * An amount field. The value is read under the amount rules, the quote must hold exactly one amount, and that amount
 * must be the value, compared in canonical form, so "1 234,50" and "1234.50" agree when they mean the same amount. The
 * currency must already be verified, because the minor units depend on it.
 */
function verifyAmount(
  sourced: Sourced<string>,
  docPages: readonly string[],
  currency: FieldEvidence<SupportedCurrency>,
  minimumMinor: number,
): FieldEvidence<PrintedTotal> {
  if (sourced === null) {
    return missing();
  }
  const found = locate(sourced.quote, docPages);
  if (!found.ok) {
    return ambiguousAt(found.reason, null);
  }
  const reading = canonicalAmount(sourced.value);
  if (!reading.ok) {
    return ambiguousAt(reading.reason, found.at);
  }
  const quoted = amountTokensIn(found.at.quote);
  if (quoted.length !== 1) {
    return ambiguousAt('AMOUNT_QUOTE_AMBIGUOUS', found.at);
  }
  const [printed = ''] = quoted;
  const quotedReading = canonicalAmount(printed);
  if (!quotedReading.ok || quotedReading.canonical !== reading.canonical) {
    return ambiguousAt('VALUE_NOT_IN_QUOTE', found.at);
  }
  if (currency.status !== 'EXACT' || currency.value === null) {
    return ambiguousAt('CURRENCY_UNVERIFIED', found.at);
  }
  const parsed = parseMoneyText(reading.canonical, currency.value);
  if (!parsed.ok) {
    return ambiguousAt('AMOUNT_FORMAT', found.at);
  }
  if (parsed.minor < minimumMinor) {
    return ambiguousAt('AMOUNT_NOT_PAYABLE', found.at);
  }
  return exactAt({ printed, canonical: reading.canonical, minor: parsed.minor }, found.at);
}

/**
 * The VAT arithmetic, in integer minor units. A stated VAT line needs a stated subtotal, and both must verify. The
 * subtotal and VAT together must equal the total. Without VAT, a subtotal must equal the total. Anything else is held.
 */
function reconcile(
  total: FieldEvidence<PrintedTotal>,
  subtotal: FieldEvidence<PrintedTotal> | null,
  vat: FieldEvidence<PrintedTotal> | null,
): Reconciliation {
  if (subtotal === null && vat === null) {
    return { status: 'NOT_STATED', reason: null };
  }
  if (total.status !== 'EXACT' || total.value === null) {
    return { status: 'UNVERIFIED', reason: 'TOTAL_NOT_VERIFIED' };
  }
  const totalMinor = total.value.minor;
  if (vat !== null && subtotal === null) {
    return { status: 'INCOMPLETE', reason: 'SUBTOTAL_NOT_STATED' };
  }
  if (subtotal !== null && subtotal.status !== 'EXACT') {
    return { status: 'UNVERIFIED', reason: `SUBTOTAL_${subtotal.reason ?? subtotal.status}` };
  }
  if (vat === null) {
    if (subtotal?.value?.minor === totalMinor) {
      return { status: 'RECONCILED', reason: null };
    }
    return { status: 'NOT_RECONCILED', reason: 'SUBTOTAL_NOT_TOTAL' };
  }
  if (vat.status !== 'EXACT' || vat.value === null) {
    return { status: 'UNVERIFIED', reason: `VAT_${vat.reason ?? vat.status}` };
  }
  const sum = (subtotal?.value?.minor ?? 0) + vat.value.minor;
  return sum === totalMinor
    ? { status: 'RECONCILED', reason: null }
    : { status: 'NOT_RECONCILED', reason: 'SUBTOTAL_PLUS_VAT_NOT_TOTAL' };
}

/** Checks every field of an extraction against the document pages (already normalised for comparison). */
export function verifyInvoice(
  extraction: InvoiceExtraction & StatedAmounts,
  pages: readonly string[],
): VerifiedInvoice {
  const docPages = pages.map(normaliseText);
  const currency = verifyCurrency(extraction.currency, docPages);
  const total = verifyAmount(extraction.totalAsPrinted, docPages, currency, 1);
  const subtotal =
    extraction.subtotalAsPrinted === undefined || extraction.subtotalAsPrinted === null
      ? null
      : verifyAmount(extraction.subtotalAsPrinted, docPages, currency, 0);
  const vat =
    extraction.vatAsPrinted === undefined || extraction.vatAsPrinted === null
      ? null
      : verifyAmount(extraction.vatAsPrinted, docPages, currency, 0);
  return {
    supplierName: verifyContained(extraction.supplierName, docPages),
    invoiceNumber: verifyContained(extraction.invoiceNumber, docPages),
    invoiceDate: verifyDate(extraction.invoiceDate, docPages),
    currency,
    total,
    purchaseOrderNumber: verifyContained(extraction.purchaseOrderNumber, docPages),
    payeeAccountAsPrinted: verifyContained(extraction.payeeAccountAsPrinted, docPages),
    reconciliation: reconcile(total, subtotal, vat),
  };
}

/**
 * The reasons an invoice cannot go forward, as "field:reason" strings. Every required field must be EXACT. The printed
 * account is optional, but if the invoice states one it must be verified, because it is compared with the enrolled
 * account. Stated amounts must reconcile. An empty list means the invoice may go on to matching.
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
  const { reconciliation } = verified;
  if (reconciliation.status !== 'NOT_STATED' && reconciliation.status !== 'RECONCILED') {
    reasons.push(`amounts:${reconciliation.reason ?? reconciliation.status}`);
  }
  return reasons;
}
