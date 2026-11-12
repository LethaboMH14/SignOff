import type { EvidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import {
  fingerprintOf,
  normaliseInvoiceNumber,
  obligationKey,
} from '../../../../packages/shared/src/node.js';
import {
  DEFAULT_MATCH_TOLERANCE,
  receiptCovers,
  supplierNameKey,
  type Tolerance,
  withinTolerance,
} from '../../../../packages/shared/src/match-rules.js';
import type { SupportedCurrency } from '../../../../packages/shared/src/money/minor-units.js';

import type { SupplierMaster } from './supplier-master.js';

/**
 * Matching: the verified invoice against the buyer's own records. The invoice record is found by the file's SHA-256,
 * and the purchase order and goods receipt by the number the invoice prints. Every check here compares a value the
 * document stated with a value the document cannot write. Any difference is a hold.
 *
 * Tolerance and name rules are shared with the Warden (packages/shared/src/match-rules.ts), so the same input gives
 * the same verdict on both sides. A supplier name selects a candidate only; the payee account decides who is paid.
 */

export interface VerifiedValues {
  readonly supplierName: string;
  readonly invoiceNumber: string;
  readonly currency: SupportedCurrency;
  readonly totalMinor: number;
  readonly purchaseOrderNumber: string;
  /** The account the invoice prints, or null when it prints none. */
  readonly payeeAccountAsPrinted: string | null;
}

export interface MatchInput {
  readonly values: VerifiedValues;
  readonly fingerprint: string;
  readonly evidence: EvidenceRegister;
  readonly suppliers: readonly SupplierMaster[];
  /** True when a payment for this obligation may already exist. */
  readonly alreadyPaid: (obligationKey: string) => boolean;
  /** The buyer's match tolerance. Defaults to the shared default, which the Warden uses too. */
  readonly tolerance?: Tolerance;
}

export type MatchResult =
  | {
      readonly ok: true;
      readonly supplierId: string;
      readonly obligationKey: string;
      readonly amountMinor: number;
      readonly recordSha256s: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reasons: readonly string[];
      /** The obligation, when the supplier was found, so the hold is recorded against the right payable. */
      readonly obligationKey: string | null;
      readonly recordSha256s: readonly string[];
    };

/** Compares account numbers by their letters and digits only, so spaces and dashes do not matter. */
export function accountKey(text: string): string {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function findSupplier(
  suppliers: readonly SupplierMaster[],
  legalName: string,
): { readonly supplier: SupplierMaster } | { readonly reason: string } {
  const key = supplierNameKey(legalName);
  const matches = suppliers.filter((supplier) => supplierNameKey(supplier.legalName) === key);
  const [only] = matches;
  if (only === undefined || key === '') {
    return { reason: 'SUPPLIER_UNKNOWN' };
  }
  if (matches.length > 1) {
    return { reason: 'SUPPLIER_AMBIGUOUS' };
  }
  return { supplier: only };
}

export function matchInvoice(input: MatchInput): MatchResult {
  const { values, evidence } = input;
  const tolerance = input.tolerance ?? DEFAULT_MATCH_TOLERANCE;
  const invoice = evidence.invoice(input.fingerprint);
  if (invoice === undefined) {
    return { ok: false, reasons: ['NO_INVOICE_RECORD'], obligationKey: null, recordSha256s: [] };
  }
  const recordSha256s = [fingerprintOf(invoice)];

  const found = findSupplier(input.suppliers, values.supplierName);
  if (!('supplier' in found)) {
    return { ok: false, reasons: [found.reason], obligationKey: null, recordSha256s };
  }
  const { supplier } = found;
  const key = obligationKey(supplier.supplierId, values.invoiceNumber);
  const reasons: string[] = [];
  if (supplier.status !== 'approved') {
    reasons.push('SUPPLIER_NOT_APPROVED');
  }
  if (invoice.supplierId !== supplier.supplierId) {
    reasons.push('SUPPLIER_MISMATCH');
  }
  if (
    normaliseInvoiceNumber(invoice.invoiceNumber) !== normaliseInvoiceNumber(values.invoiceNumber)
  ) {
    reasons.push('INVOICE_NUMBER_MISMATCH');
  }
  if (invoice.currency !== values.currency) {
    reasons.push('CURRENCY_MISMATCH');
  }
  if (invoice.amountMinor !== values.totalMinor) {
    reasons.push('AMOUNT_MISMATCH');
  }
  if (invoice.purchaseOrderId !== values.purchaseOrderNumber) {
    reasons.push('PO_MISMATCH');
  }

  const order = evidence.purchaseOrder(values.purchaseOrderNumber);
  if (order === undefined) {
    reasons.push('PO_NOT_FOUND');
  } else {
    recordSha256s.push(fingerprintOf(order));
    if (order.supplierId !== supplier.supplierId) {
      reasons.push('PO_SUPPLIER_MISMATCH');
    }
    if (order.currency !== values.currency) {
      reasons.push('PO_CURRENCY_MISMATCH');
    }
    if (order.status === 'closed') {
      reasons.push('PO_CLOSED');
    }
    const alreadyInvoiced = order.invoicedMinor ?? 0;
    if (alreadyInvoiced > 0) {
      // An order already invoiced in part: the invoices together may not pass the order's value.
      const cumulative = alreadyInvoiced + invoice.amountMinor;
      if (
        cumulative > order.amountMinor &&
        !withinTolerance(order.amountMinor, cumulative, tolerance)
      ) {
        reasons.push('PO_FULLY_INVOICED');
      }
    } else if (!withinTolerance(order.amountMinor, invoice.amountMinor, tolerance)) {
      // The single-invoice case: the same rule the Warden applies, in both directions.
      reasons.push(
        invoice.amountMinor > order.amountMinor ? 'AMOUNT_EXCEEDS_ORDER' : 'AMOUNT_MISMATCH',
      );
    }
  }

  const receipt = evidence.goodsReceipt(values.purchaseOrderNumber);
  if (receipt === undefined) {
    reasons.push('NO_GOODS_RECEIPT');
  } else {
    recordSha256s.push(fingerprintOf(receipt));
    if (!receiptCovers(invoice.amountMinor, receipt.receivedMinor, tolerance)) {
      reasons.push('AMOUNT_EXCEEDS_RECEIPT');
    }
    if (order !== undefined && receipt.receivedMinor > order.amountMinor) {
      if (!withinTolerance(order.amountMinor, receipt.receivedMinor, tolerance)) {
        // Over-delivery does not raise the payable, but a receipt above the order is a person's question.
        reasons.push('RECEIPT_EXCEEDS_ORDER');
      }
    }
  }

  const enrolled = supplier.enrolledPayeeAsPrinted;
  if (values.payeeAccountAsPrinted !== null) {
    if (enrolled === null) {
      reasons.push('PAYEE_NOT_ENROLLED');
    } else if (accountKey(values.payeeAccountAsPrinted) !== accountKey(enrolled)) {
      reasons.push('PAYEE_CHANGED');
    }
  }
  if (
    enrolled !== null &&
    invoice.payeeAccountAsPrinted !== null &&
    accountKey(invoice.payeeAccountAsPrinted) !== accountKey(enrolled)
  ) {
    reasons.push('PAYEE_CHANGED');
  }

  if (input.alreadyPaid(key)) {
    reasons.push('DUPLICATE_PAYMENT');
  }

  if (reasons.length > 0) {
    return { ok: false, reasons: [...new Set(reasons)], obligationKey: key, recordSha256s };
  }
  return {
    ok: true,
    supplierId: supplier.supplierId,
    obligationKey: key,
    amountMinor: invoice.amountMinor,
    recordSha256s,
  };
}
