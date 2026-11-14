/**
 * Credentials (XLS-70) and permissioned domains (XLS-80): the on-ledger rule a supplier must meet before the Warden
 * pays it. The buyer's Warden account issues a credential to the supplier, the supplier accepts it, and the buyer's
 * permissioned domain lists which credentials count. The builders below are pure; the reads live on the ledger port.
 *
 * A payment is not sent through the domain: a domain gates DEX and AMM offers. Here the domain is the buyer's
 * on-ledger list of accepted credentials, and the Warden reads it and checks the supplier against it before signing.
 */

/** The accepted-flag bit of a credential object: set once the subject has accepted it. */
export const LSF_ACCEPTED = 0x00010000;

/** An issuer and a credential type, as a domain lists them. The type is hexadecimal. */
export interface CredentialTypeRef {
  readonly issuer: string;
  readonly credentialType: string;
}

/** A credential type name as the hexadecimal the ledger stores: 1 to 64 bytes of UTF-8. */
export function credentialTypeHex(name: string): string {
  const bytes = Buffer.from(name, 'utf8');
  if (bytes.length === 0 || bytes.length > 64) {
    throw new RangeError('a credential type is 1 to 64 bytes of UTF-8');
  }
  return bytes.toString('hex').toUpperCase();
}

/** The issuer creates the credential for the subject. The subject must still accept it. */
export function credentialCreateTx(issuer: string, subject: string, credentialType: string) {
  return {
    TransactionType: 'CredentialCreate' as const,
    Account: issuer,
    Subject: subject,
    CredentialType: credentialType,
  };
}

/** The subject accepts a credential the issuer created. Only an accepted credential counts. */
export function credentialAcceptTx(subject: string, issuer: string, credentialType: string) {
  return {
    TransactionType: 'CredentialAccept' as const,
    Account: subject,
    Issuer: issuer,
    CredentialType: credentialType,
  };
}

/** The owner sets its permissioned domain: the list of credentials that count for it. */
export function permissionedDomainSetTx(owner: string, accepted: readonly CredentialTypeRef[]) {
  if (accepted.length === 0 || accepted.length > 10) {
    throw new RangeError('a permissioned domain accepts 1 to 10 credentials');
  }
  return {
    TransactionType: 'PermissionedDomainSet' as const,
    Account: owner,
    AcceptedCredentials: accepted.map((ref) => ({
      Credential: { Issuer: ref.issuer, CredentialType: ref.credentialType },
    })),
  };
}
