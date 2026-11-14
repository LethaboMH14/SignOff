import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { canonicalJson } from '../../../packages/shared/src/canonical.js';
import { readJsonOrThrow } from '../../../packages/warden-api/src/client.js';

import type { ChangeRequest } from './service.js';

/**
 * Supplier-side tooling for the Warden's payout-change route. The supplier's own key signs the change, so the Warden
 * can check it against the key on record. The caller client for the agent and operators lives in packages/warden-api.
 */

export {
  ClientError,
  coSignAsAgent,
  WardenClient,
  type WardenClientOptions,
} from '../../../packages/warden-api/src/client.js';

/**
 * A supplier's payout-change request. The request is signed with the supplier's current key, and the Warden accepts
 * it only if that key matches the one on record.
 */
export class SupplierClient {
  constructor(
    private readonly baseUrl: string,
    private readonly supplierId: string,
    private readonly privateKey: KeyObject,
  ) {}

  async requestChange(request: Omit<ChangeRequest, 'supplierId'>): Promise<unknown> {
    const signed: ChangeRequest = { ...request, supplierId: this.supplierId };
    const signature = sign(
      null,
      Buffer.from(canonicalJson(signed), 'utf8'),
      this.privateKey,
    ).toString('base64');
    const response = await fetch(
      new URL(`/v1/suppliers/${encodeURIComponent(this.supplierId)}/changes`, this.baseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: signed, signature }),
      },
    );
    return readJsonOrThrow(response);
  }
}

/** A new Ed25519 key for a supplier. The public key is what the Warden stores; the private key stays with the supplier. */
export function generateSupplierKey(): {
  readonly privateKey: KeyObject;
  readonly publicKey: string;
} {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}
