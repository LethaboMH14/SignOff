/**
 * The plain-language catalogue for the reason codes the console shows. The codes come from the Warden's decisions and
 * the agent's transition log. Every entry is fixed text, written once and reviewed; nothing is generated per invoice.
 * A code without an entry is shown as its code, never as an invented sentence. This module has no Node imports.
 */

/**
 * Plain-language text for each logged reason code. Every entry is fixed text written once and reviewed; nothing is
 * generated per invoice. A code without an entry is shown as its code, never as an invented sentence.
 */
const REASON_TEXT: ReadonlyMap<string, string> = new Map<string, string>([
  ['OK', 'No problem found at this step.'],
  ['PAYEE_CHANGED', 'The account on the invoice is not the account this supplier enrolled.'],
  ['PAYEE_CHANGE_CLAIM', 'The invoice says the bank details have changed.'],
  ['PAYEE_NOT_VERIFIED', 'The payee has not been verified.'],
  ['MISSING_EVIDENCE', 'A record needed to check the invoice is missing.'],
  ['AMOUNT_MISMATCH', 'The amount does not match the record it is checked against.'],
  ['DUPLICATE', 'This invoice or payable already has a payment in progress or settled.'],
  ['OVER_LIMIT', 'This payment would go over a limit set by the operator.'],
  ['PAUSED', 'New payments are paused by the operator.'],
  ['ACCOUNT_FROZEN', 'The asset or an account is frozen on the ledger.'],
  ['LEDGER_UNREADABLE', 'The ledger could not be read, so nothing was signed.'],
  ['INVARIANT_FAILED', 'A safety check failed, so the payment was stopped.'],
  [
    'ACCOUNT_BUSY',
    'Another payment from the spending account is still being settled. This one waits until it is resolved.',
  ],
  [
    'RECEIVING_CAPACITY',
    'The supplier account cannot receive this amount yet because it is over the limit it set for this asset.',
  ],
  ['UNSUPPORTED_TRANSACTION', 'This kind of payment is not allowed.'],
  ['SUPPLIER_NOT_APPROVED', 'The supplier is not approved yet.'],
  ['SIGNER_CHANGE_NOT_APPROVED', 'A change to the signing setup needs two approvals.'],
  ['VERIFICATION_FAILED', 'A field could not be checked against its quote.'],
  ['FIELD_NOT_STATED', 'A field is not stated in the invoice text.'],
  ['MODEL_CALL_FAILED', 'The model did not return a usable reply, so the invoice is held.'],
  [
    'INSTRUCTION_LIKE_TEXT',
    'The invoice text contains instruction-like wording, which is treated as data.',
  ],
  ['MARKUP_IN_TEXT', 'The invoice text contains markup, which is treated as data.'],
  ['MATCH_FAILED', 'The invoice could not be matched to one purchase order and receipt.'],
  ['PO_NOT_FOUND', 'No purchase order matches the invoice.'],
  ['PO_MISMATCH', 'The purchase order does not agree with the invoice.'],
  ['PO_SUPPLIER_MISMATCH', 'The purchase order belongs to a different supplier.'],
  ['PO_CURRENCY_MISMATCH', 'The purchase order is in a different currency from the invoice.'],
  ['NO_GOODS_RECEIPT', 'No goods receipt is recorded for the purchase order.'],
  ['NO_INVOICE_RECORD', 'The invoice is not in the records the agent checks against.'],
  ['AMOUNT_MISMATCH', 'The amount does not match the record it is checked against.'],
  ['AMOUNT_EXCEEDS_ORDER', 'The invoice is for more than the order.'],
  ['AMOUNT_EXCEEDS_RECEIPT', 'The invoice is for more than was received.'],
  ['AMOUNT_NOT_PAYABLE', 'The amount is not a payable amount.'],
  ['AMOUNT_FORMAT', 'The amount is written in a layout the agent cannot read with certainty.'],
  ['CURRENCY_MISMATCH', 'The currency does not match the record it is checked against.'],
  ['CURRENCY_NOT_STATED', 'The invoice does not state its currency.'],
  ['DATE_FORMAT', 'The date is written in a layout the agent cannot read with certainty.'],
  ['DUPLICATE_PAYMENT', 'A payment for this invoice already exists.'],
  ['INVOICE_NUMBER_MISMATCH', 'The invoice number does not match the record.'],
  ['SUPPLIER_AMBIGUOUS', 'The supplier cannot be identified with certainty.'],
  ['PAYEE_NOT_ENROLLED', 'The payee is not the enrolled account.'],
  ['QUOTE_NOT_FOUND', 'A value the agent read has no matching quote in the invoice text.'],
  ['QUOTE_AMBIGUOUS', 'A value the agent read matches more than one place in the invoice text.'],
  ['PDF_UNREADABLE', 'The PDF could not be read.'],
  ['PDF_ENCRYPTED', 'The PDF is encrypted, so it cannot be read.'],
  ['NO_TEXT_LAYER', 'The PDF has no text layer, so it cannot be read.'],
  ['SCREEN_FLAGGED', 'The screen flagged the invoice text for a person to check.'],
  ['MODEL_OUTPUT_INVALID', 'The model reply did not match the required form, so it is not used.'],
  ['PROPOSAL_INVALID', 'The payment proposal did not match its schema.'],
  ['SIGNING_FAILED', 'The signature could not be made, so nothing was sent.'],
  ['OUTCOME_UNKNOWN', 'The outcome is not known yet, so the invoice is not treated as paid.'],
]);

export function reasonTextOf(code: string): string {
  return REASON_TEXT.get(code) ?? `Reason code ${code}: no plain text yet.`;
}

/** Every code that has plain text. A test checks the Warden's codes are all here. */
export function catalogueCodes(): readonly string[] {
  return [...REASON_TEXT.keys()];
}
