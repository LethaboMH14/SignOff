import { readFileSync } from 'node:fs';
import { z } from 'zod';

import {
  CurrencyCode,
  IsoInstant,
  MinorUnits,
  PayableMinorUnits,
  SchemaVersion,
  Sha256Hex,
  SupplierId,
} from '../../../packages/shared/src/schemas/index.js';

/**
 * The evidence the Warden checks a payment against: invoices, purchase orders and goods receipts. These come
 * from the buyer's systems and are read-only here. The Warden never trusts a document to name its own payee:
 * the invoice record only states the account printed on it, and that is compared with the verified record.
 */

const Ref = z.string().min(1).max(64);

export const InvoiceRecord = z.strictObject({
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

/** Lookups used by the decision. A missing record is evidence that is missing, never a default. */
export interface EvidenceRegister {
  invoice(fingerprint: string): InvoiceRecord | undefined;
  purchaseOrder(purchaseOrderId: string): PurchaseOrderRecord | undefined;
  goodsReceipt(purchaseOrderId: string): GoodsReceiptRecord | undefined;
}

/** Builds the lookups. Two records with the same key make the file ambiguous, so that is refused. */
export function evidenceRegister(file: EvidenceFile): EvidenceRegister {
  const invoices = indexBy(file.invoices, (record) => record.fingerprint, 'invoice fingerprint');
  const orders = indexBy(file.purchaseOrders, (record) => record.purchaseOrderId, 'purchase order');
  const receipts = indexBy(file.goodsReceipts, (record) => record.purchaseOrderId, 'goods receipt');
  return {
    invoice: (fingerprint) => invoices.get(fingerprint),
    purchaseOrder: (purchaseOrderId) => orders.get(purchaseOrderId),
    goodsReceipt: (purchaseOrderId) => receipts.get(purchaseOrderId),
  };
}

function indexBy<T>(items: readonly T[], key: (item: T) => string, label: string): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (index.has(id)) {
      throw new Error(`the evidence file repeats the ${label}`);
    }
    index.set(id, item);
  }
  return index;
}

/** Reads and validates the evidence file. Anything that does not match the schema stops the Warden. */
export function loadEvidence(path: string): EvidenceRegister {
  // The path is the operator's evidence export, read once at start-up.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return evidenceRegister(EvidenceFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown));
}
