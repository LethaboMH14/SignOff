import { decode, hashes, multisign, type Transaction, type Wallet } from 'xrpl';

import { MAX_FEE_DROPS } from './constants.js';

/**
 * Throws unless the transaction has a fee and the fee is within the cap. Every signer checks this before signing, so a
 * fee spike or a tampered fee field is refused by each key, not only by the one that built the transaction.
 */
export function assertFeeWithinCap(transaction: Transaction): void {
  const fee = (transaction as { Fee?: unknown }).Fee;
  if (typeof fee !== 'string' || !/^[0-9]+$/.test(fee)) {
    throw new Error('the transaction has no fee, so it is not signed');
  }
  if (BigInt(fee) > BigInt(MAX_FEE_DROPS)) {
    throw new Error('the transaction fee is above the cap, so it is not signed');
  }
}

/** Signs a transaction as one signer of a multi-signed transaction and returns the signed blob. */
export function signAsSigner(wallet: Wallet, transaction: Transaction): string {
  assertFeeWithinCap(transaction);
  return wallet.sign(transaction, true).tx_blob;
}

/** Combines the signed blobs of several signers into one multi-signed blob. */
export function combineSigned(blobs: readonly string[]): string {
  if (blobs.length === 0) {
    throw new Error('nothing to combine');
  }
  return multisign([...blobs]);
}

/** The accounts that signed a blob, sorted. An unsigned or single-key blob has none. */
export function signerAccounts(blob: string): string[] {
  const tx = decode(blob) as unknown as {
    readonly Signers?: readonly { readonly Signer: { readonly Account: string } }[];
  };
  return (tx.Signers ?? []).map((entry) => entry.Signer.Account).sort();
}

/** Throws unless the blob carries exactly these signers and no others. Used before every submission. */
export function assertSignedExactly(blob: string, accounts: readonly string[]): void {
  // Account addresses are base58 and never contain a comma, so a joined list compares exactly.
  const actual = signerAccounts(blob).join(',');
  const expected = [...accounts].sort().join(',');
  if (actual !== expected) {
    throw new Error('the blob is not signed by exactly the required signers');
  }
}

/** The transaction hash of a signed blob. Computed locally, before submission, so it is known in advance. */
export function hashOfSigned(blob: string): string {
  return hashes.hashSignedTx(blob);
}
