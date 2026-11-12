/**
 * SARS tax-invoice checks, in integer cents. A missing or wrong field is a HOLD with its reason; nothing is inferred.
 *
 * Source for the threshold (R1, research branch origin/claude/research-r1-intake-c26aae, docs/research/R1-intake-and-formats.md,
 * section on SA tax invoices, read 12 Nov 2026): "A business is required to issue a full tax invoice when the price is
 * more than R5 000" and "may issue an abridged tax invoice when the consideration for the supply is R 5 000 or less than
 * R5 000" (SARS, page "Last Updated: 11/03/2021").
 *
 * The mandatory field lists are SECONDARY and UNVERIFIED (R1 section 3 says so: the VAT Act section 20 text was not read).
 * They are kept in one table so a verified list replaces it in one place.
 */

export const ZAR_ABRIDGED_CEILING_MINOR = 500_000; // R5 000.00, the threshold R1 quotes
export const VAT_RATE_BASIS_POINTS = 1_500; // 15%

/** The VAT on a subtotal in cents, rounded half up, with integer arithmetic only. */
export function vatMinorOf(subtotalMinor: number): number {
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0) {
    throw new RangeError('the subtotal must be a non-negative whole number of cents');
  }
  return Math.floor((subtotalMinor * VAT_RATE_BASIS_POINTS + 5_000) / 10_000);
}

export interface TaxInvoiceFields {
  readonly documentKind: 'full' | 'abridged' | 'unknown';
  readonly supplierName: string | null;
  readonly supplierVatNumber: string | null;
  readonly supplierAddress: string | null;
  readonly buyerName: string | null;
  readonly buyerVatNumber: string | null;
  readonly invoiceNumber: string | null;
  readonly invoiceDate: string | null;
  readonly description: string | null;
  /** Amount before VAT, in cents, when printed. */
  readonly subtotalMinor: number | null;
  /** VAT printed on the document, in cents, when printed. */
  readonly vatMinor: number | null;
  /** The total the document states, in cents. */
  readonly totalMinor: number | null;
  readonly currency: string | null;
}

export type TaxHold =
  | { readonly code: 'MISSING_FIELD'; readonly field: string }
  | { readonly code: 'ABRIDGED_OVER_LIMIT' }
  | { readonly code: 'FULL_INVOICE_REQUIRED' }
  | { readonly code: 'VAT_NUMBER_FORMAT'; readonly field: 'supplierVatNumber' | 'buyerVatNumber' }
  | { readonly code: 'VAT_ARITHMETIC'; readonly detail: string }
  | { readonly code: 'NOT_ZAR' };

/** Abridged mandatory fields (secondary list, unverified). */
const ABRIDGED_FIELDS = [
  'supplierName',
  'supplierVatNumber',
  'invoiceNumber',
  'invoiceDate',
  'description',
  'totalMinor',
] as const;

/** Full-invoice fields in addition to the abridged set (secondary list, unverified). */
const FULL_EXTRA_FIELDS = [
  'supplierAddress',
  'buyerName',
  'buyerVatNumber',
  'subtotalMinor',
  'vatMinor',
] as const;

/**
 * A South African VAT registration number is ten digits and starts with 4 (practitioner sources in R1, unverified
 * against SARS). The check fails closed on anything else.
 */
export function isSarsVatNumber(value: string): boolean {
  return /^4\d{9}$/.test(value.replace(/[\s-]/g, ''));
}

export interface TaxCheckResult {
  readonly ok: boolean;
  readonly holds: readonly TaxHold[];
  /** Whether the amount needs a full tax invoice under the R1 threshold. */
  readonly requiresFull: boolean;
}

export function checkTaxInvoice(fields: TaxInvoiceFields): TaxCheckResult {
  const holds: TaxHold[] = [];
  if (fields.currency !== null && fields.currency !== 'ZAR') {
    holds.push({ code: 'NOT_ZAR' });
  }

  const largest = Math.max(fields.totalMinor ?? 0, fields.subtotalMinor ?? 0);
  const requiresFull = largest > ZAR_ABRIDGED_CEILING_MINOR;

  if (fields.documentKind === 'abridged' && requiresFull) {
    holds.push({ code: 'ABRIDGED_OVER_LIMIT' });
  }
  if (requiresFull && fields.documentKind !== 'full') {
    holds.push({ code: 'FULL_INVOICE_REQUIRED' });
  }

  const required: readonly string[] = requiresFull
    ? [...ABRIDGED_FIELDS, ...FULL_EXTRA_FIELDS]
    : [...ABRIDGED_FIELDS];
  const values: ReadonlyMap<string, string | number | null> = new Map([
    ['supplierName', fields.supplierName],
    ['supplierVatNumber', fields.supplierVatNumber],
    ['supplierAddress', fields.supplierAddress],
    ['buyerName', fields.buyerName],
    ['buyerVatNumber', fields.buyerVatNumber],
    ['invoiceNumber', fields.invoiceNumber],
    ['invoiceDate', fields.invoiceDate],
    ['description', fields.description],
    ['subtotalMinor', fields.subtotalMinor],
    ['vatMinor', fields.vatMinor],
    ['totalMinor', fields.totalMinor],
  ]);
  for (const field of required) {
    const value = values.get(field) ?? null;
    if (value === null || value === '') {
      holds.push({ code: 'MISSING_FIELD', field });
    }
  }

  for (const field of ['supplierVatNumber', 'buyerVatNumber'] as const) {
    const value = values.get(field);
    if (typeof value === 'string' && !isSarsVatNumber(value)) {
      holds.push({ code: 'VAT_NUMBER_FORMAT', field });
    }
  }

  const { subtotalMinor, vatMinor, totalMinor } = fields;
  if (subtotalMinor !== null && vatMinor !== null) {
    const expected = vatMinorOf(subtotalMinor);
    if (vatMinor !== expected) {
      holds.push({
        code: 'VAT_ARITHMETIC',
        detail: `15% of the subtotal is ${String(expected)} cents, the document prints ${String(vatMinor)}`,
      });
    }
    if (totalMinor !== null && totalMinor !== subtotalMinor + vatMinor) {
      holds.push({
        code: 'VAT_ARITHMETIC',
        detail: `subtotal plus VAT is ${String(subtotalMinor + vatMinor)} cents, the document prints ${String(totalMinor)}`,
      });
    }
  }

  return { ok: holds.length === 0, holds, requiresFull };
}
