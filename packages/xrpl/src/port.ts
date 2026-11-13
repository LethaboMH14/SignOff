import type { CredentialTypeRef } from './credentials.js';
import type { SubmittableTransaction, Wallet } from 'xrpl';
import type { SignerListView } from './signer-list.js';
import type { LedgerLookup } from './reconcile.js';

/** A token identity: the currency code and the account that issued it. */
export interface TokenRef {
  readonly currency: string;
  readonly issuer: string;
}

export interface AccountSnapshot {
  readonly address: string;
  readonly balanceDrops: string;
  readonly sequence: number;
  readonly ownerCount: number;
  readonly flags: number;
  readonly regularKeyPresent: boolean;
  readonly signerList: SignerListView | null;
}

export interface TrustLineSnapshot {
  readonly balance: string;
  readonly limit: string;
  /** True when the issuer has frozen this line: the holder cannot move the token. */
  readonly frozenByIssuer: boolean;
  /** True when the holder has frozen its own line. */
  readonly frozenByHolder: boolean;
}

/** The part of a submit response that matters: the engine result and whether it was applied. */
export interface SubmitOutcome {
  readonly engineResult: string;
  readonly accepted: boolean;
  readonly applied: boolean;
}

export interface Reserves {
  readonly baseDrops: string;
  readonly incrementDrops: string;
}

/**
 * Everything the orchestration needs from the ledger. The XRPL adapter implements it against a real
 * endpoint; tests implement it against an in-memory ledger that models the same rules.
 */
export interface LedgerPort {
  readonly endpoint: string;
  networkId(): Promise<number>;
  validatedLedgerIndex(): Promise<number>;
  baseFeeDrops(): Promise<string>;
  reserves(): Promise<Reserves>;
  account(address: string): Promise<AccountSnapshot | null>;
  trustLine(holder: string, token: TokenRef): Promise<TrustLineSnapshot | null>;
  /** Credentials (XLS-70): whether the subject holds this credential from this issuer, accepted. Optional. */
  credentialAccepted?(subject: string, issuer: string, credentialType: string): Promise<boolean>;
  /** A permissioned domain (XLS-80): what it accepts, or null when it is not on the ledger. Optional. */
  permissionedDomainAccepts?(
    owner: string,
    sequence: number,
  ): Promise<readonly CredentialTypeRef[] | null>;
  autofill(transaction: SubmittableTransaction, signers: number): Promise<SubmittableTransaction>;
  submit(txBlob: string): Promise<SubmitOutcome>;
  lookup(hash: string): Promise<LedgerLookup>;
  fund(wallet: Wallet): Promise<void>;
  disconnect(): Promise<void>;
}
