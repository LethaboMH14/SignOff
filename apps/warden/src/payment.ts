import type { Payment } from 'xrpl';

import { compareDecimal } from '../../../packages/xrpl/src/amounts.js';

/**
 * The one shape of payment the Warden will build or sign. The Warden writes every field itself: the agent
 * never supplies a destination, an amount or a tag, and a payment with any other shape is refused.
 */

/** The asset on the ledger. The issuer and currency come from policy, never from a proposal. */
export interface AssetRef {
  readonly ledgerCurrency: string;
  readonly issuer: string;
}

export interface PaymentTerms {
  readonly spending: string;
  readonly destination: string;
  readonly destinationTag: number | null;
  readonly asset: AssetRef;
  /** The amount as a decimal string, in the asset's own units. */
  readonly value: string;
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

/** The unsigned Payment for these terms. The tag is set only when the enrolled payee has one. */
export function paymentFor(terms: PaymentTerms): Payment {
  return {
    TransactionType: 'Payment',
    Account: terms.spending,
    Destination: terms.destination,
    Amount: {
      currency: terms.asset.ledgerCurrency,
      issuer: terms.asset.issuer,
      value: terms.value,
    },
    ...(terms.destinationTag === null ? {} : { DestinationTag: terms.destinationTag }),
  };
}

/**
 * A plain payment carries no flags, except the canonical-signature flag, which does not change what the payment
 * does. Every other flag is refused, so no flag can alter the payment without this check seeing it.
 */
const TF_FULLY_CANONICAL_SIG = 0x80000000;

/** Fields that only a non-plain payment can carry. Their presence is refused. */
const FORBIDDEN_FIELDS = ['Paths', 'SendMax', 'DeliverMin', 'Memos'] as const;

/**
 * Throws unless a transaction is exactly the payment the Warden decided on: a plain Payment, from the expected
 * account, to the enrolled destination and tag, for the expected asset, issuer and amount. Memos are refused,
 * so keys and invoice data cannot be written to the ledger through this path.
 */
export function assertWardenPayment(
  tx: Readonly<Record<string, unknown>>,
  terms: PaymentTerms,
): void {
  if (tx['TransactionType'] !== 'Payment') {
    throw new GuardError('the transaction is not a payment');
  }
  if (tx['Account'] !== terms.spending) {
    throw new GuardError('the paying account is not the spending account');
  }
  if (tx['Destination'] !== terms.destination) {
    throw new GuardError('the destination is not the enrolled payee');
  }
  if (terms.destinationTag === null) {
    if (tx['DestinationTag'] !== undefined) {
      throw new GuardError('the transaction carries a destination tag the payee does not have');
    }
  } else if (tx['DestinationTag'] !== terms.destinationTag) {
    throw new GuardError('the destination tag is not the enrolled tag');
  }
  const amount = tx['Amount'];
  if (typeof amount !== 'object' || amount === null) {
    throw new GuardError('the amount is not an issued currency');
  }
  const issued = amount as Readonly<Record<string, unknown>>;
  if (
    issued['currency'] !== terms.asset.ledgerCurrency ||
    issued['issuer'] !== terms.asset.issuer
  ) {
    throw new GuardError('the asset is not the expected currency and issuer');
  }
  if (typeof issued['value'] !== 'string' || compareDecimal(issued['value'], terms.value) !== 0) {
    throw new GuardError('the amount is not the approved amount');
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (Reflect.get(tx, field) !== undefined) {
      throw new GuardError('the transaction carries a field that a plain payment cannot have');
    }
  }
  const flags = tx['Flags'] ?? 0;
  if (typeof flags !== 'number') {
    throw new GuardError('the transaction flags are not a number');
  }
  if ((flags & ~TF_FULLY_CANONICAL_SIG) !== 0) {
    throw new GuardError('the transaction flags change what the payment can do');
  }
}

/**
 * The fields that bind an agent's co-signature to the Warden's transaction. Signatures and signer lists are
 * left out, because they differ between the two signatures on the same transaction.
 */
export const BOUND_FIELDS = [
  'TransactionType',
  'Account',
  'Destination',
  'DestinationTag',
  'Amount',
  'Fee',
  'Sequence',
  'LastLedgerSequence',
  'Flags',
] as const;

/** The bound fields of a transaction as canonical text, for comparison. */
export function boundFieldsOf(tx: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    BOUND_FIELDS.map((field): [string, unknown] => [field, Reflect.get(tx, field)]).filter(
      ([, value]) => value !== undefined,
    ),
  );
}
