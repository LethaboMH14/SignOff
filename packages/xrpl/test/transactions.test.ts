import { describe, expect, it } from 'vitest';
import { ASF_DEFAULT_RIPPLE, ASF_DISABLE_MASTER } from '../src/constants.js';
import {
  buildDisableMaster,
  buildEnableDefaultRipple,
  buildIssuedPayment,
  buildSignerListSet,
  buildTrustSet,
  buildXrpPayment,
} from '../src/transactions.js';

const A = 'rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const B = 'rBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2';
const C = 'rCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3';
const CURRENCY = '524C555344000000000000000000000000000000';

describe('buildSignerListSet', () => {
  it('builds the two-signer list with quorum two', () => {
    const tx = buildSignerListSet(A, 2, [
      { account: B, weight: 1 },
      { account: C, weight: 1 },
    ]);
    expect(tx).toEqual({
      TransactionType: 'SignerListSet',
      Account: A,
      SignerQuorum: 2,
      SignerEntries: [
        { SignerEntry: { Account: B, SignerWeight: 1 } },
        { SignerEntry: { Account: C, SignerWeight: 1 } },
      ],
    });
  });

  it('refuses lists the ledger would reject or that could never reach quorum', () => {
    expect(() => buildSignerListSet(A, 2, [])).toThrow('at least one signer');
    expect(() =>
      buildSignerListSet(A, 2, [
        { account: B, weight: 1 },
        { account: B, weight: 1 },
      ]),
    ).toThrow('only once');
    expect(() => buildSignerListSet(A, 1, [{ account: A, weight: 1 }])).toThrow('own signer');
    expect(() => buildSignerListSet(A, 2, [{ account: B, weight: 0 }])).toThrow(
      'positive integers',
    );
    expect(() =>
      buildSignerListSet(A, 3, [
        { account: B, weight: 1 },
        { account: C, weight: 1 },
      ]),
    ).toThrow('the weights can reach');
    expect(() => buildSignerListSet(A, 0, [{ account: B, weight: 1 }])).toThrow(
      'the weights can reach',
    );
  });
});

describe('account settings', () => {
  it('disables the master key and turns on DefaultRipple with the documented flags', () => {
    expect(buildDisableMaster(A)).toEqual({
      TransactionType: 'AccountSet',
      Account: A,
      SetFlag: ASF_DISABLE_MASTER,
    });
    expect(buildEnableDefaultRipple(A)).toEqual({
      TransactionType: 'AccountSet',
      Account: A,
      SetFlag: ASF_DEFAULT_RIPPLE,
    });
    expect(ASF_DISABLE_MASTER).toBe(4);
    expect(ASF_DEFAULT_RIPPLE).toBe(8);
  });
});

describe('buildTrustSet', () => {
  it('sets a positive limit for the token', () => {
    expect(buildTrustSet(A, { currency: CURRENCY, issuer: B, value: '1000.00' })).toEqual({
      TransactionType: 'TrustSet',
      Account: A,
      LimitAmount: { currency: CURRENCY, issuer: B, value: '1000' },
    });
  });

  it('refuses a zero limit', () => {
    expect(() => buildTrustSet(A, { currency: CURRENCY, issuer: B, value: '0' })).toThrow(
      'greater than zero',
    );
  });
});

describe('payments', () => {
  it('builds an issued-currency payment with a canonical value', () => {
    expect(buildIssuedPayment(A, B, { currency: CURRENCY, issuer: C, value: '12.5' })).toEqual({
      TransactionType: 'Payment',
      Account: A,
      Destination: B,
      Amount: { currency: CURRENCY, issuer: C, value: '12.5' },
    });
  });

  it('builds an XRP payment whose amount is a string of drops', () => {
    expect(buildXrpPayment(A, B, '1000000')).toEqual({
      TransactionType: 'Payment',
      Account: A,
      Destination: B,
      Amount: '1000000',
    });
  });

  it('refuses payments to the same account and malformed drops', () => {
    expect(() => buildIssuedPayment(A, A, { currency: CURRENCY, issuer: C, value: '1' })).toThrow(
      'same account',
    );
    expect(() => buildXrpPayment(A, A, '1')).toThrow('same account');
    expect(() => buildXrpPayment(A, B, '1.5')).toThrow('positive integer string');
    expect(() => buildXrpPayment(A, B, '0')).toThrow('positive integer string');
  });
});
