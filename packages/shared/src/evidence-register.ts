import type {
  EvidenceFile,
  GoodsReceiptRecord,
  InvoiceRecord,
  PurchaseOrderRecord,
} from './schemas/evidence.js';

/** Lookups used by a decision. A missing record is evidence that is missing, never a default. */
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
