import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

import { decode, type SubmittableTransaction, type Wallet } from 'xrpl';

import { combineSigned, signAsSigner } from '../../../packages/xrpl/src/index.js';

import { signatureFor, signingText } from './auth.js';
import { canonicalJson } from './canonical.js';
import type { ChangeRequest, CoSignResult, ProposeResult } from './service.js';

/**
 * The calling side of the Warden's API, for the agent, the operators and the suppliers. This module holds only
 * the caller's own secret or key. It never imports the Warden's key, so a caller cannot sign as the Warden.
 */

export class ClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
  }
}

export interface WardenClientOptions {
  readonly baseUrl: string;
  readonly principalId: string;
  readonly secret: Buffer;
  readonly now?: () => Date;
}

function errorMessageOf(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const message = (payload as { readonly error: unknown }).error;
    if (typeof message === 'string') {
      return message;
    }
  }
  return 'the request failed';
}

/** One caller's connection to the Warden. Each request is signed with the caller's secret. */
export class WardenClient {
  constructor(private readonly options: WardenClientOptions) {}

  health(): Promise<{ readonly paused: boolean; readonly policyVersion: string }> {
    return this.send('GET', '/v1/health', undefined, false) as Promise<{
      readonly paused: boolean;
      readonly policyVersion: string;
    }>;
  }

  propose(proposal: unknown): Promise<ProposeResult> {
    return this.send('POST', '/v1/proposals', proposal, true) as Promise<ProposeResult>;
  }

  coSign(attemptId: string, signedBlob: string): Promise<CoSignResult> {
    return this.send(
      'POST',
      `/v1/attempts/${attemptId}/co-signature`,
      { signedBlob },
      true,
    ) as Promise<CoSignResult>;
  }

  setPaused(paused: boolean): Promise<unknown> {
    return this.send('POST', paused ? '/v1/control/pause' : '/v1/control/resume', undefined, true);
  }

  setLimits(patch: unknown): Promise<unknown> {
    return this.send('POST', '/v1/policy/limits', patch, true);
  }

  approveProposal(proposal: unknown): Promise<unknown> {
    return this.send('POST', '/v1/approvals', { proposal }, true);
  }

  enrolSupplier(input: unknown): Promise<unknown> {
    return this.send('POST', '/v1/suppliers', input, true);
  }

  approveSupplier(supplierId: string): Promise<unknown> {
    return this.send('POST', `/v1/suppliers/${supplierId}/approve`, undefined, true);
  }

  confirmChange(supplierId: string, changeId: string): Promise<unknown> {
    return this.send(
      'POST',
      `/v1/suppliers/${supplierId}/changes/${changeId}/confirm`,
      undefined,
      true,
    );
  }

  approveChange(supplierId: string, changeId: string): Promise<unknown> {
    return this.send(
      'POST',
      `/v1/suppliers/${supplierId}/changes/${changeId}/approve`,
      undefined,
      true,
    );
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signed: boolean,
  ): Promise<unknown> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signed) {
      const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
      const nonce = randomBytes(16).toString('hex');
      headers['x-signoff-principal'] = this.options.principalId;
      headers['x-signoff-timestamp'] = timestamp;
      headers['x-signoff-nonce'] = nonce;
      headers['x-signoff-signature'] = signatureFor(
        this.options.secret,
        signingText(method, path, timestamp, nonce, text),
      );
    }
    const response = await fetch(new URL(path, this.options.baseUrl), {
      method,
      headers,
      ...(text === '' ? {} : { body: text }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ClientError(response.status, errorMessageOf(payload));
    }
    return payload;
  }
}

/**
 * A supplier's payout-change request. The request is signed with the supplier's current key, and the Warden
 * accepts it only if that key matches the one on record.
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
      new URL(`/v1/suppliers/${this.supplierId}/changes`, this.baseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: signed, signature }),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ClientError(response.status, errorMessageOf(payload));
    }
    return payload;
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

/**
 * The agent's half of the two-signature payment. The agent signs the transaction the Warden returned, with
 * its own key, and combines the two signatures. The fields are not changed, so the Warden can check them.
 */
export function coSignAsAgent(agent: Wallet, wardenBlob: string): string {
  // decode returns a transaction object or throws for input that is not a transaction.
  const fields: Record<string, unknown> = { ...decode(wardenBlob) };
  delete fields['Signers'];
  const agentBlob = signAsSigner(agent, fields as unknown as SubmittableTransaction);
  return combineSigned([wardenBlob, agentBlob]);
}
