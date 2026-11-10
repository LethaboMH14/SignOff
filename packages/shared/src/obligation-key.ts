import { createHash } from 'node:crypto';

/**
 * The stable identity of a payable. Node-only, because it hashes.
 *
 * The key depends on exactly two things: the supplier and the normalised invoice number. It does not
 * depend on the amount, the document, the retry count or the time. An edited amount, a re-sent PDF or
 * a retried payment therefore lands on the same obligation, which is what stops a single bill from
 * being paid twice under a new identity.
 */

const KEY_VERSION = 1;

/**
 * NFKC, upper case, then only letters and digits are kept. Spaces, hyphens and other punctuation are
 * dropped, so "INV-001", "INV 001" and "inv001" are one payable.
 *
 * The rule errs toward a hold. Two genuinely different invoices whose numbers differ only in
 * punctuation would be held for a person to review, which costs a minute. A duplicate that passed as
 * a "different" number could be paid twice, which costs money.
 */
export function normaliseInvoiceNumber(invoiceNumber: string): string {
  return invoiceNumber
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * SHA-256 over a JSON array of [version, supplier, normalised invoice number]. JSON array encoding
 * keeps the parts from running into each other, so no combination of values can collide by accident.
 */
export function obligationKey(supplierId: string, invoiceNumber: string): string {
  const canonical = JSON.stringify([
    KEY_VERSION,
    supplierId,
    normaliseInvoiceNumber(invoiceNumber),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
