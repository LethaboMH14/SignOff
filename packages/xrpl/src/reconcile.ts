import { type IssuedAmount, sameIouAmount } from './amounts.js';

/**
 * The amount a payment must deliver, as the payer intended it. 'none' is for transactions that move no
 * value (trust lines, account settings): success is tesSUCCESS alone.
 */
export type Expected =
  | { readonly kind: 'xrp'; readonly drops: string }
  | { readonly kind: 'iou'; readonly amount: IssuedAmount }
  | { readonly kind: 'none' };

/** The amount the ledger says was delivered. Unknown is never treated as a match. */
export type Delivered =
  | { readonly kind: 'xrp'; readonly drops: string }
  | { readonly kind: 'iou'; readonly amount: IssuedAmount }
  | { readonly kind: 'unknown' };

/** What the ledger reports for a transaction hash. */
export type LedgerLookup =
  | {
      readonly status: 'validated';
      readonly engineResult: string;
      readonly ledgerIndex: number;
      readonly delivered: Delivered;
    }
  | { readonly status: 'not-validated' };

export type Decision =
  | { readonly kind: 'paid'; readonly ledgerIndex: number }
  | { readonly kind: 'failed'; readonly engineResult: string; readonly ledgerIndex: number }
  | { readonly kind: 'hold'; readonly reason: 'delivered-mismatch' | 'validated-after-expiry' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'rejected'; readonly engineResult: string };

export interface ReconcileInput {
  readonly expected: Expected;
  readonly lookup: LedgerLookup;
  /** The highest validated ledger index known to this client. */
  readonly lastValidatedLedger: number;
  /** The transaction's LastLedgerSequence. */
  readonly lastLedgerSequence: number;
}

function deliveredMatches(expected: Expected, delivered: Delivered): boolean {
  if (expected.kind === 'none') {
    return true;
  }
  if (expected.kind === 'xrp') {
    return delivered.kind === 'xrp' && delivered.drops === expected.drops;
  }
  return delivered.kind === 'iou' && sameIouAmount(expected.amount, delivered.amount);
}

/**
 * Decides what a transaction's outcome means. Only a validated tesSUCCESS that delivered the expected
 * amount is paid. A transaction is expired only when a validated ledger beyond its LastLedgerSequence
 * exists and the hash is still not validated: at that point it can never apply, so a new attempt is safe.
 */
export function decide(input: ReconcileInput): Decision {
  const { expected, lookup, lastValidatedLedger, lastLedgerSequence } = input;
  if (lookup.status === 'validated') {
    if (lookup.ledgerIndex > lastLedgerSequence) {
      return { kind: 'hold', reason: 'validated-after-expiry' };
    }
    if (lookup.engineResult !== 'tesSUCCESS') {
      return { kind: 'failed', engineResult: lookup.engineResult, ledgerIndex: lookup.ledgerIndex };
    }
    if (!deliveredMatches(expected, lookup.delivered)) {
      return { kind: 'hold', reason: 'delivered-mismatch' };
    }
    return { kind: 'paid', ledgerIndex: lookup.ledgerIndex };
  }
  if (lastValidatedLedger > lastLedgerSequence) {
    return { kind: 'expired' };
  }
  return { kind: 'wait' };
}
