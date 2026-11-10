import type { InvoiceExtraction } from '../../src/schemas/invoice.js';
import type { Obligation } from '../../src/schemas/obligation.js';
import type { PaymentProposal } from '../../src/schemas/proposal.js';

/**
 * Fictional, valid examples. Tests copy and then break them one field at a time, so each failure
 * is attributable to exactly one rule. No real supplier, account or person appears here.
 */

export const FIXTURE_OBLIGATION_KEY =
  'aaf402ce52cab0b4a365a39d0cb53a19e75fc92fdaef4ef8b38436c89d95176e';

export function validInvoiceExtraction(): InvoiceExtraction {
  return {
    schemaVersion: 1,
    supplierName: { value: 'Solar Supply Example Ltd', quote: 'Solar Supply Example Ltd' },
    invoiceNumber: { value: 'INV-001', quote: 'Invoice No: INV-001' },
    invoiceDate: { value: '2026-11-10', quote: 'Date: 2026-11-10' },
    currency: { value: 'ZAR', quote: 'Total (ZAR)' },
    totalAsPrinted: { value: '12,500.50', quote: 'Total: 12,500.50' },
    purchaseOrderNumber: { value: 'PO-0042', quote: 'PO: PO-0042' },
    payeeAccountAsPrinted: { value: 'Account 0123456789', quote: 'Account 0123456789' },
  };
}

export function validProposal(): PaymentProposal {
  return {
    schemaVersion: 1,
    obligationKey: FIXTURE_OBLIGATION_KEY,
    attemptId: '6f1c2e0a-4b7d-4c1e-9a0b-3d5e7f8a9b0c',
    supplierId: 'SUP-ABC123',
    currency: 'ZAR',
    amountMinor: 1250050,
    invoiceFingerprint: 'a'.repeat(64),
    policyVersion: '2026-11-10.1',
    proposedBy: 'agent',
    proposedAt: '2026-11-10T10:00:00Z',
  };
}

export function validObligation(): Obligation {
  return {
    schemaVersion: 1,
    obligationKey: FIXTURE_OBLIGATION_KEY,
    supplierId: 'SUP-ABC123',
    currency: 'ZAR',
    approvedMinor: 1250050,
    reservedMinor: 0,
    settledMinor: 0,
    status: 'OPEN',
    version: 0,
  };
}
