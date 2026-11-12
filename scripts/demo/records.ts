// Buyer records for one demo invoice. Pure: it returns the new evidence file and writes nothing, so the runner can
// write it before any process reads it.
import { EvidenceFile } from '../../packages/shared/src/schemas/evidence.js';

export interface InvoiceRecordInput {
  readonly fingerprint: string;
  readonly supplierId: string;
  readonly invoiceNumber: string;
  /** The currency the invoice is written in: ZAR for the agent's buyer record. */
  readonly currency: string;
  readonly amountMinor: number;
  readonly purchaseOrderId: string;
  readonly payeeAccountAsPrinted: string | null;
  readonly receivedAt: string;
}

/** Adds one invoice, its purchase order and its goods receipt to an evidence file. Existing records are kept. */
export function withInvoiceRecord(file: EvidenceFile, input: InvoiceRecordInput): EvidenceFile {
  return EvidenceFile.parse({
    ...file,
    invoices: [
      ...file.invoices,
      {
        fingerprint: input.fingerprint,
        supplierId: input.supplierId,
        invoiceNumber: input.invoiceNumber,
        currency: input.currency,
        amountMinor: input.amountMinor,
        purchaseOrderId: input.purchaseOrderId,
        payeeAccountAsPrinted: input.payeeAccountAsPrinted,
      },
    ],
    purchaseOrders: [
      ...file.purchaseOrders,
      {
        purchaseOrderId: input.purchaseOrderId,
        supplierId: input.supplierId,
        currency: input.currency,
        amountMinor: input.amountMinor,
      },
    ],
    goodsReceipts: [
      ...file.goodsReceipts,
      {
        purchaseOrderId: input.purchaseOrderId,
        receivedMinor: input.amountMinor,
        receivedAt: input.receivedAt,
      },
    ],
  });
}
