import { sha256Hex } from './canonical.js';
import type { PayeeRecord } from './events.js';

/**
 * The independent check that a payee belongs to the business it claims to be. In production this is bank
 * account verification plus a registry lookup, done outside the system. Here it is simulated: a fixed list
 * of payees is treated as verified, and every result says it was simulated.
 */
export interface IdentityResult {
  readonly status: 'verified' | 'failed';
  /** A reference for the record. It never contains the payee account itself. */
  readonly reference: string;
}

export interface IdentityChecker {
  check(supplierId: string, payee: PayeeRecord): Promise<IdentityResult>;
}

/** Simulated check. Payees on the allow-list pass; every other payee fails. */
export function simulatedIdentityChecker(verifiedAddresses: ReadonlySet<string>): IdentityChecker {
  return {
    check: (supplierId, payee) => {
      const verified = verifiedAddresses.has(payee.address);
      const digest = sha256Hex(`${supplierId}\n${payee.address}`).slice(0, 12);
      return Promise.resolve({
        status: verified ? 'verified' : 'failed',
        reference: `simulated-identity:${digest}`,
      });
    },
  };
}
