import { describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';

import {
  assertWardenPayment,
  BOUND_FIELDS,
  boundFieldsOf,
  GuardError,
  paymentFor,
  type PaymentTerms,
} from '../src/payment.js';

const SPENDING = Wallet.generate().address;
const PAYEE = Wallet.generate().address;
const ISSUER = Wallet.generate().address;

const TERMS: PaymentTerms = {
  spending: SPENDING,
  destination: PAYEE,
  destinationTag: null,
  asset: { ledgerCurrency: 'TST', issuer: ISSUER },
  value: '10',
};

/** A payment shaped as the Warden builds it, with overrides for each case. */
function plain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    TransactionType: 'Payment',
    Account: SPENDING,
    Destination: PAYEE,
    Amount: { currency: 'TST', issuer: ISSUER, value: '10' },
    Flags: 0,
    ...overrides,
  };
}

/** Runs the guard and returns true when it passes; a refusal throws. Keeps each assertion on a value-returning arrow. */
function passes(tx: Readonly<Record<string, unknown>>, terms: PaymentTerms = TERMS): boolean {
  assertWardenPayment(tx, terms);
  return true;
}

describe('the payment the Warden builds', () => {
  it('sets the destination tag only when the enrolled payee has one', () => {
    expect(paymentFor(TERMS)).not.toHaveProperty('DestinationTag');
    expect(paymentFor({ ...TERMS, destinationTag: 7 })).toMatchObject({ DestinationTag: 7 });
    expect(paymentFor({ ...TERMS, destinationTag: 0 })).toMatchObject({ DestinationTag: 0 });
  });

  it('is a plain payment with the approved account, destination, asset and amount', () => {
    expect(paymentFor(TERMS)).toEqual({
      TransactionType: 'Payment',
      Account: SPENDING,
      Destination: PAYEE,
      Amount: { currency: 'TST', issuer: ISSUER, value: '10' },
    });
  });
});

describe('the transaction guard', () => {
  it('accepts exactly the approved payment', () => {
    expect(() => passes(plain())).not.toThrow();
  });

  it('accepts the same amount written with different decimal places', () => {
    expect(() =>
      passes(plain({ Amount: { currency: 'TST', issuer: ISSUER, value: '10.00' } })),
    ).not.toThrow();
  });

  it('accepts a payment with no flags field, and one with only the canonical-signature flag', () => {
    const noFlags = plain();
    delete noFlags['Flags'];
    expect(() => passes(noFlags)).not.toThrow();
    expect(() => passes(plain({ Flags: 0x80000000 }))).not.toThrow();
  });

  it('accepts a payment with the tag the enrolled payee has, and refuses a missing or different tag', () => {
    const tagged = { ...TERMS, destinationTag: 7 };
    expect(() => passes(plain({ DestinationTag: 7 }), tagged)).not.toThrow();
    expect(() => passes(plain(), tagged)).toThrow('not the enrolled tag');
    expect(() => passes(plain({ DestinationTag: 8 }), tagged)).toThrow('not the enrolled tag');
  });

  it('refuses each field that differs from the approved payment, with a reason for each', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      [
        'a transaction that is not a payment',
        plain({ TransactionType: 'AccountSet' }),
        'not a payment',
      ],
      ['another paying account', plain({ Account: PAYEE }), 'spending account'],
      ['another destination', plain({ Destination: SPENDING }), 'enrolled payee'],
      [
        'a tag the payee does not have',
        plain({ DestinationTag: 5 }),
        'destination tag the payee does not have',
      ],
      [
        'another currency',
        plain({ Amount: { currency: 'USD', issuer: ISSUER, value: '10' } }),
        'expected currency and issuer',
      ],
      [
        'another issuer',
        plain({ Amount: { currency: 'TST', issuer: SPENDING, value: '10' } }),
        'expected currency and issuer',
      ],
      [
        'another amount',
        plain({ Amount: { currency: 'TST', issuer: ISSUER, value: '10.01' } }),
        'approved amount',
      ],
      [
        'an amount with no value',
        plain({ Amount: { currency: 'TST', issuer: ISSUER } }),
        'approved amount',
      ],
      ['an amount in drops', plain({ Amount: '10000000' }), 'not an issued currency'],
      ['path finding', plain({ Paths: [[]] }), 'cannot have'],
      [
        'a spend maximum',
        plain({ SendMax: { currency: 'TST', issuer: ISSUER, value: '20' } }),
        'cannot have',
      ],
      [
        'a delivery minimum',
        plain({ DeliverMin: { currency: 'TST', issuer: ISSUER, value: '5' } }),
        'cannot have',
      ],
      ['memos', plain({ Memos: [{ Memo: { MemoData: '41' } }] }), 'cannot have'],
      ['the partial payment flag', plain({ Flags: 0x00020000 }), 'flags change'],
      ['the limit quality flag', plain({ Flags: 0x00040000 }), 'flags change'],
      ['any other flag', plain({ Flags: 0x00010000 }), 'flags change'],
      ['flags that are not a number', plain({ Flags: 'none' }), 'not a number'],
    ];
    for (const [label, tx, message] of cases) {
      expect(() => passes(tx), label).toThrow(message);
    }
  });

  it('refuses every case with a GuardError, so the service can map it to a refusal', () => {
    expect(() => passes(plain({ Memos: [] }))).toThrow(GuardError);
  });
});

describe('the fields an agent co-signature is bound to', () => {
  it('includes the payment fields and leaves out the signatures and signer list', () => {
    expect(BOUND_FIELDS).toEqual(
      expect.arrayContaining(['Account', 'Destination', 'Amount', 'Fee', 'Sequence', 'Flags']),
    );
    expect(BOUND_FIELDS).not.toContain('Signers');
    expect(BOUND_FIELDS).not.toContain('TxnSignature');
  });

  it('returns only the bound fields, and leaves out values that are not set', () => {
    const bound = boundFieldsOf({
      ...plain({ Fee: '12', Sequence: 3, LastLedgerSequence: 99 }),
      Signers: [{ Signer: { Account: SPENDING, TxnSignature: 'AA' } }],
      SigningPubKey: '',
    });
    expect(Object.keys(bound).sort()).toEqual(
      [
        'Account',
        'Amount',
        'Destination',
        'Fee',
        'Flags',
        'LastLedgerSequence',
        'Sequence',
        'TransactionType',
      ].sort(),
    );
    expect(boundFieldsOf({})).toEqual({});
  });
});
