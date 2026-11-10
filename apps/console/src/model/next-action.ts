/**
 * What a person does next for each reason code that holds or refuses an invoice. The text is fixed and authored, and it
 * is a draft until a person has reviewed it. Nothing here is generated per invoice. This module has no Node imports.
 */

const NEXT_ACTIONS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    'PAYEE_CHANGED',
    'Check the bank details with the supplier through a number already on file, then approve or reject the change.',
  ],
  [
    'PAYEE_CHANGE_CLAIM',
    'Confirm the new bank details with the supplier through a number already on file before any change is made.',
  ],
  ['PAYEE_NOT_VERIFIED', 'Verify the supplier payee record before proposing the payment again.'],
  ['MISSING_EVIDENCE', 'Link the purchase order or goods receipt, then propose the invoice again.'],
  [
    'AMOUNT_MISMATCH',
    'Compare the invoice amount with the order and receipt, correct the record or the invoice, then propose again.',
  ],
  [
    'DUPLICATE',
    'Check whether this invoice was already paid or is already in progress. Do not pay it twice.',
  ],
  [
    'OVER_LIMIT',
    'Ask an operator to review the limit. A raised limit needs a second operator to approve it.',
  ],
  ['PAUSED', 'Wait until an operator resumes payments. Nothing is paid while payments are paused.'],
  [
    'ACCOUNT_FROZEN',
    'Check the asset and account status on the ledger with the issuer before trying again.',
  ],
  [
    'LEDGER_UNREADABLE',
    'Wait for the ledger to be readable again. Nothing was signed, so nothing needs undoing.',
  ],
  [
    'INVARIANT_FAILED',
    'Ask a developer to check the safety check that failed before any payment of this kind is proposed.',
  ],
  [
    'UNSUPPORTED_TRANSACTION',
    'This kind of payment is not allowed. Pay it outside the agent or change the request.',
  ],
  [
    'SUPPLIER_NOT_APPROVED',
    'Get the supplier approved by two operators in the Warden, then propose the invoice again.',
  ],
  [
    'SIGNER_CHANGE_NOT_APPROVED',
    'A change to the signing setup needs two approvals. Get both before trying again.',
  ],
  [
    'VERIFICATION_FAILED',
    'Check the field against the invoice text yourself, then correct the record or the reading.',
  ],
  [
    'FIELD_NOT_STATED',
    'Read the invoice by hand and enter the missing field, or ask the supplier to restate it.',
  ],
  [
    'MODEL_CALL_FAILED',
    'The model did not answer usefully. Read the invoice by hand, or run the agent again later.',
  ],
  [
    'INSTRUCTION_LIKE_TEXT',
    'The invoice text has instruction-like wording. A person reads the invoice before anything else happens.',
  ],
  [
    'MARKUP_IN_TEXT',
    'The invoice text has markup. A person reads the invoice before anything else happens.',
  ],
  [
    'MATCH_FAILED',
    'Match the invoice to one purchase order and one receipt by hand, then propose again.',
  ],
  [
    'PO_NOT_FOUND',
    'Find the purchase order the invoice refers to, or ask the buyer for it, then propose again.',
  ],
  [
    'PO_MISMATCH',
    'Check the purchase order against the invoice and correct whichever record is wrong.',
  ],
  [
    'PO_SUPPLIER_MISMATCH',
    'The purchase order belongs to another supplier. Find the right order or the right supplier.',
  ],
  [
    'PO_CURRENCY_MISMATCH',
    'The purchase order and the invoice use different currencies. Confirm the currency with the supplier.',
  ],
  [
    'NO_GOODS_RECEIPT',
    'Record the goods receipt for the purchase order, then propose the invoice again.',
  ],
  [
    'NO_INVOICE_RECORD',
    'Add the invoice to the records the agent checks against, then propose it again.',
  ],
  [
    'AMOUNT_EXCEEDS_ORDER',
    'The invoice is more than the order. Ask the buyer to raise the order or the supplier to correct the invoice.',
  ],
  [
    'AMOUNT_EXCEEDS_RECEIPT',
    'The invoice is more than was received. Confirm what was received, then decide.',
  ],
  [
    'AMOUNT_NOT_PAYABLE',
    'The amount is not payable as written. Ask the supplier for a corrected invoice.',
  ],
  ['AMOUNT_FORMAT', 'Read the amount by hand and enter it in the record, then propose again.'],
  [
    'CURRENCY_MISMATCH',
    'The currency on the invoice does not match the record. Confirm the currency with the supplier.',
  ],
  [
    'CURRENCY_NOT_STATED',
    'The invoice does not state its currency. Ask the supplier to restate it.',
  ],
  ['DATE_FORMAT', 'Read the date by hand and enter it in the record, then propose again.'],
  [
    'DUPLICATE_PAYMENT',
    'A payment for this invoice already exists. Check the payment list before doing anything else.',
  ],
  [
    'INVOICE_NUMBER_MISMATCH',
    'The invoice number does not match the record. Confirm the number with the supplier.',
  ],
  [
    'SUPPLIER_AMBIGUOUS',
    'The supplier cannot be identified with certainty. Confirm which supplier sent the invoice.',
  ],
  [
    'PAYEE_NOT_ENROLLED',
    'The payee is not the enrolled account. Enrol the account through the supplier process, or reject the invoice.',
  ],
  [
    'QUOTE_NOT_FOUND',
    'A value the agent read has no quote in the invoice text. Read the value by hand.',
  ],
  [
    'QUOTE_AMBIGUOUS',
    'A value appears in more than one place in the invoice text. Read the value by hand.',
  ],
  ['PDF_UNREADABLE', 'The PDF could not be read. Ask the supplier for a readable copy.'],
  ['PDF_ENCRYPTED', 'The PDF is encrypted. Ask the supplier for an unlocked copy.'],
  [
    'NO_TEXT_LAYER',
    'The PDF has no text layer. Ask the supplier for a text PDF, or read the invoice by hand.',
  ],
  [
    'SCREEN_FLAGGED',
    'The screen flagged the invoice text. A person checks the text before anything else happens.',
  ],
  [
    'MODEL_OUTPUT_INVALID',
    'The model reply was not in the required form and was not used. Read the invoice by hand, or run again later.',
  ],
  [
    'PROPOSAL_INVALID',
    'The payment proposal did not match its schema. A developer checks the agent output before any retry.',
  ],
  [
    'SIGNING_FAILED',
    'The signature could not be made, so nothing was sent. Check the signing setup, then try again.',
  ],
  [
    'OUTCOME_UNKNOWN',
    'The outcome is not known yet. Wait for the reconciler to settle it. Do not pay the invoice again.',
  ],
]);

/** The next step for a reason code, or a plain statement that none is written yet. Never an invented step. */
export function nextActionOf(code: string): string {
  return (
    NEXT_ACTIONS.get(code) ??
    `No next step is written for code ${code} yet. Ask an operator to review it.`
  );
}

/** The codes that have a written next step. A test checks every code that can hold or refuse an invoice is here. */
export function nextActionCodes(): readonly string[] {
  return [...NEXT_ACTIONS.keys()];
}

/** An account for display: only its last four characters. A value too short to mask is shown as hidden entirely. */
export function maskAccount(account: string | null): string | null {
  if (account === null) {
    return null;
  }
  return account.length > 4 ? `…${account.slice(-4)}` : '…';
}
