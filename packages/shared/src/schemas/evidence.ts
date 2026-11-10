import { z } from 'zod';

import {
  CurrencyCode,
  IsoInstant,
  MinorUnits,
  PayableMinorUnits,
  SchemaVersion,
  Sha256Hex,
  SupplierId,
} from './primitives.js';

/**
 * The evidence a payment is checked against: invoices, purchase orders and goods receipts, exported read-only from
 * the buyer's systems. The Warden and the agent both read this shape, so it lives in shared code. A document never
 * names its own payee: an invoice record states only the account printed on the invoice, and that account is
 * compared with the verified supplier record.
 */

const Ref = z.string().min(1).max(64);

export const InvoiceRecord = z.strictObject({
  /** SHA-256 of the invoice file as it was received. This is how a file is matched to its record. */
  fingerprint: Sha256Hex,
  supplierId: SupplierId,
  invoiceNumber: z.string().min(1).max(64),
  currency: CurrencyCode,
  amountMinor: PayableMinorUnits,
  purchaseOrderId: Ref.nullable(),
  payeeAccountAsPrinted: z.string().min(1).max(80).nullable(),
});
export type InvoiceRecord = z.infer<typeof InvoiceRecord>;

export const PurchaseOrderRecord = z.strictObject({
  purchaseOrderId: Ref,
  supplierId: SupplierId,
  currency: CurrencyCode,
  amountMinor: PayableMinorUnits,
});
export type PurchaseOrderRecord = z.infer<typeof PurchaseOrderRecord>;

export const GoodsReceiptRecord = z.strictObject({
  purchaseOrderId: Ref,
  receivedMinor: MinorUnits,
  receivedAt: IsoInstant,
});
export type GoodsReceiptRecord = z.infer<typeof GoodsReceiptRecord>;

export const EvidenceFile = z.strictObject({
  schemaVersion: SchemaVersion,
  invoices: z.array(InvoiceRecord),
  purchaseOrders: z.array(PurchaseOrderRecord),
  goodsReceipts: z.array(GoodsReceiptRecord),
});
export type EvidenceFile = z.infer<typeof EvidenceFile>;
