import { sign, type KeyObject } from 'node:crypto';

import { decode, Wallet, type SubmittableTransaction } from 'xrpl';

import type { LedgerPort } from '../../../../packages/xrpl/src/index.js';
import { TEST_TOKEN_CURRENCY } from '../../../../packages/xrpl/src/constants.js';
import { buildTrustSet, signAsSigner } from '../../../../packages/xrpl/src/index.js';
import { canonicalJson } from '../../src/canonical.js';
import { coSignAsAgent } from '../../src/client.js';
import { WardenError, type WardenService } from '../../src/service.js';
import type { WardenReasonCode } from '../../../../packages/shared/src/schemas/index.js';
import {
  newAttemptId,
  proposalFor,
  SUPPLIER,
  type Base,
  type Clock,
  type InvoiceEntry,
} from '../helpers/world.js';
import type { WardenConfig } from '../../src/config.js';

/** The operators the attack cases use. Two distinct people are needed for any approval. */
export const OPERATOR_A = 'operator-a';
export const OPERATOR_B = 'operator-b';

/** Enrols a supplier to a payee and approves it with two operators, as the operator desk does. */
export async function activeSupplier(
  service: WardenService,
  payeeAddress: string,
  publicKey: string,
): Promise<void> {
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: payeeAddress, destinationTag: null },
      publicKey,
    },
    OPERATOR_A,
  );
  await service.approveSupplier(SUPPLIER, OPERATOR_B);
}

/** A port whose every call fails while `down` is set, to model a ledger endpoint that times out. */
export interface Outage {
  down: boolean;
}

export function outagePort(base: Base, outage: Outage): LedgerPort {
  const wrapped = Object.entries(base.port).map(([key, value]: [string, unknown]) => {
    if (typeof value !== 'function') {
      return [key, value];
    }
    const method = value as (...args: unknown[]) => Promise<unknown>;
    return [
      key,
      (...args: unknown[]) => {
        if (outage.down) {
          return Promise.reject(new Error('ledger endpoint timed out'));
        }
        return method.apply(base.port, args);
      },
    ];
  });
  return Object.fromEntries(wrapped) as LedgerPort;
}

/** The first reason code a decision carries, or null for ALLOW. */
export function firstReason(decision: {
  readonly reasons: readonly { readonly code: WardenReasonCode }[];
}): WardenReasonCode | null {
  return decision.reasons[0]?.code ?? null;
}

/** The status and message of a co-signature the Warden refused. Fails the test if the call succeeded. */
export async function refusalOf(
  work: Promise<unknown>,
): Promise<{ readonly status: number; readonly message: string }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof WardenError) {
      return { status: error.status, message: error.message };
    }
    throw error;
  }
  throw new Error('the Warden accepted the call, but the attack case expected a refusal');
}

/** A Warden-only signature over the prepared terms: what a stolen Warden key alone could produce. */
export function wardenOnlyBlob(base: Base, preparedBlob: string): string {
  const fields = { ...decode(preparedBlob) } as unknown as SubmittableTransaction;
  return signAsSigner(base.wardenWallet, fields);
}

/** A payout-change request signed with a supplier's current key. The signature covers this exact object. */
export function signedChange(
  privateKey: KeyObject,
  newAddress: string,
  nonce: string,
  requestedAt: Date,
): { readonly request: unknown; readonly signature: string } {
  const request = {
    supplierId: SUPPLIER,
    newPayee: { address: newAddress, destinationTag: null },
    newPublicKey: null,
    requestedAt: requestedAt.toISOString(),
    nonce,
  };
  const signature = sign(null, Buffer.from(canonicalJson(request), 'utf8'), privateKey).toString(
    'base64',
  );
  return { request, signature };
}

/** A wallet on the test ledger with a trust line to the given issuer only, for a payee that holds the wrong asset. */
export async function payeeTrustingOnly(base: Base, issuer: string): Promise<string> {
  const wallet = Wallet.generate();
  base.ledger.fund(wallet);
  const trust = buildTrustSet(wallet.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer,
    value: '1000000',
  });
  const prepared = await base.port.autofill(trust, 0);
  await base.port.submit(wallet.sign(prepared).tx_blob);
  base.ledger.advance();
  return wallet.address;
}

/** Proposes an entry and, if the Warden allows it, runs the agent's co-signature and the Warden's submission. */
export async function payThrough(
  service: WardenService,
  base: Base,
  config: WardenConfig,
  item: InvoiceEntry,
  clock: Clock,
): Promise<string> {
  const attemptId = newAttemptId();
  const reply = await service.propose(proposalFor(attemptId, item, config, clock.now));
  if (reply.toCoSign === null) {
    throw new Error(`the setup proposal was not allowed: ${reply.decision.decision}`);
  }
  await service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign));
  return attemptId;
}
