import {
  AccountSetAsfFlags,
  type AccountSet,
  type Payment,
  type SignerEntry,
  type SignerListSet,
  type TrustSet,
} from 'xrpl';
import { assertPositiveIou, type IssuedAmount } from './amounts.js';

/** A signer and its weight on an account's signer list. */
export interface SignerSpec {
  readonly account: string;
  readonly weight: number;
}

/** Builds a SignerListSet. Refuses configurations the ledger would reject or that could never reach quorum. */
export function buildSignerListSet(
  account: string,
  quorum: number,
  signers: readonly SignerSpec[],
): SignerListSet {
  if (signers.length === 0) {
    throw new Error('a signer list needs at least one signer');
  }
  const distinct = new Set(signers.map((signer) => signer.account));
  if (distinct.size !== signers.length) {
    throw new Error('a signer may appear only once');
  }
  if (distinct.has(account)) {
    throw new Error('an account cannot be its own signer');
  }
  let total = 0;
  for (const signer of signers) {
    if (!Number.isInteger(signer.weight) || signer.weight < 1) {
      throw new Error('signer weights must be positive integers');
    }
    total += signer.weight;
  }
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > total) {
    throw new Error('quorum must be a positive integer that the weights can reach');
  }
  const SignerEntries: SignerEntry[] = signers.map((signer) => ({
    SignerEntry: { Account: signer.account, SignerWeight: signer.weight },
  }));
  return {
    TransactionType: 'SignerListSet',
    Account: account,
    SignerQuorum: quorum,
    SignerEntries,
  };
}

/** Builds the AccountSet that disables the master key. The account must already have a signer list. */
export function buildDisableMaster(account: string): AccountSet {
  return {
    TransactionType: 'AccountSet',
    Account: account,
    SetFlag: AccountSetAsfFlags.asfDisableMaster,
  };
}

/** Builds the AccountSet that turns on DefaultRipple, which issuers need for holder-to-holder payments. */
export function buildEnableDefaultRipple(account: string): AccountSet {
  return {
    TransactionType: 'AccountSet',
    Account: account,
    SetFlag: AccountSetAsfFlags.asfDefaultRipple,
  };
}

/** Builds a TrustSet that sets a positive limit for a token issued by another account. */
export function buildTrustSet(account: string, limit: IssuedAmount): TrustSet {
  const value = assertPositiveIou(limit);
  return {
    TransactionType: 'TrustSet',
    Account: account,
    LimitAmount: { currency: value.currency, issuer: value.issuer, value: value.value },
  };
}

/** Builds a Payment of an issued currency. A payment to oneself is refused. */
export function buildIssuedPayment(
  account: string,
  destination: string,
  amount: IssuedAmount,
): Payment {
  if (account === destination) {
    throw new Error('a payment to the same account is refused');
  }
  const value = assertPositiveIou(amount);
  return {
    TransactionType: 'Payment',
    Account: account,
    Destination: destination,
    Amount: { currency: value.currency, issuer: value.issuer, value: value.value },
  };
}

/** Builds a Payment of XRP. The amount is a string of drops, never a number. */
export function buildXrpPayment(account: string, destination: string, drops: string): Payment {
  if (account === destination) {
    throw new Error('a payment to the same account is refused');
  }
  if (!/^[1-9]\d*$/.test(drops)) {
    throw new Error('drops must be a positive integer string');
  }
  return { TransactionType: 'Payment', Account: account, Destination: destination, Amount: drops };
}
