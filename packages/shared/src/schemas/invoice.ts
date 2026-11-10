import { z } from 'zod';

import { parseMoneyText, type SupportedCurrency } from '../money/minor-units.js';

import { CurrencyCode, IsoDate, SchemaVersion } from './primitives.js';

/**
 * What the extraction model returns. The model never outputs a number: every amount is text, which
 * code parses. Every value carries the exact quote it came from, and an absent value is null,
 * so "not stated" is an explicit answer, never a guess. Unknown keys are rejected, so an injected
 * field such as "payTo" fails validation.
 */

const MAX_QUOTE_LENGTH = 500;

const Quote = z.string().min(1).max(MAX_QUOTE_LENGTH);

/** A value read from the document, with the exact text it was read from. */
export function sourced<T extends z.ZodType>(value: T) {
  return z.strictObject({ value, quote: Quote });
}

export const InvoiceExtraction = z.strictObject({
  schemaVersion: SchemaVersion,
  supplierName: sourced(z.string().min(1).max(200)).nullable(),
  invoiceNumber: sourced(z.string().min(1).max(64)).nullable(),
  invoiceDate: sourced(IsoDate).nullable(),
  currency: sourced(CurrencyCode).nullable(),
  totalAsPrinted: sourced(z.string().min(1).max(40)).nullable(),
  purchaseOrderNumber: sourced(z.string().min(1).max(64)).nullable(),
  /** The account printed on the invoice. It is compared with the verified record, never paid. */
  payeeAccountAsPrinted: sourced(z.string().min(1).max(80)).nullable(),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

/** Fields a payment cannot be made without. */
export const REQUIRED_INVOICE_FIELDS = [
  'supplierName',
  'invoiceNumber',
  'invoiceDate',
  'currency',
  'totalAsPrinted',
] as const;

export type RequiredInvoiceField = (typeof REQUIRED_INVOICE_FIELDS)[number];

export interface ValidatedInvoice {
  readonly supplierName: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: string;
  readonly currency: SupportedCurrency;
  readonly totalMinor: number;
  readonly purchaseOrderNumber?: string;
  readonly payeeAccountAsPrinted?: string;
}

export type InvoiceValidation =
  | { readonly ok: true; readonly invoice: ValidatedInvoice }
  | {
      readonly ok: false;
      readonly missing: readonly RequiredInvoiceField[];
      readonly reasons: readonly string[];
    };

/**
 * Deterministic checks on an extraction: required fields are present, and the total parses to an
 * exact amount in the invoice currency. Any failure is a hold with a reason, never a payment.
 */
export function validateInvoiceFields(extraction: InvoiceExtraction): InvoiceValidation {
  const { supplierName, invoiceNumber, invoiceDate, currency, totalAsPrinted } = extraction;
  const missing: RequiredInvoiceField[] = [];
  if (supplierName === null) missing.push('supplierName');
  if (invoiceNumber === null) missing.push('invoiceNumber');
  if (invoiceDate === null) missing.push('invoiceDate');
  if (currency === null) missing.push('currency');
  if (totalAsPrinted === null) missing.push('totalAsPrinted');
  if (
    supplierName === null ||
    invoiceNumber === null ||
    invoiceDate === null ||
    currency === null ||
    totalAsPrinted === null
  ) {
    return { ok: false, missing, reasons: [] };
  }

  const parsed = parseMoneyText(totalAsPrinted.value, currency.value);
  if (!parsed.ok) {
    return { ok: false, missing: [], reasons: [`total: ${parsed.reason}`] };
  }

  const { purchaseOrderNumber, payeeAccountAsPrinted } = extraction;
  const invoice: ValidatedInvoice = {
    supplierName: supplierName.value,
    invoiceNumber: invoiceNumber.value,
    invoiceDate: invoiceDate.value,
    currency: currency.value,
    totalMinor: parsed.minor,
    ...(purchaseOrderNumber === null ? {} : { purchaseOrderNumber: purchaseOrderNumber.value }),
    ...(payeeAccountAsPrinted === null
      ? {}
      : { payeeAccountAsPrinted: payeeAccountAsPrinted.value }),
  };
  return { ok: true, invoice };
}
