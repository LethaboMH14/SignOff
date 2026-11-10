import { z } from 'zod';

import type { PaymentProposal } from '../../../../packages/shared/src/schemas/proposal.js';
import { WardenDecision } from '../../../../packages/shared/src/schemas/warden-decision.js';
import { ClientError } from '../../../../packages/warden-api/src/client.js';
import type {
  CoSignResult,
  Outcome,
  ProposeResult,
} from '../../../../packages/warden-api/src/contract.js';

/**
 * The agent's view of the Warden. The Warden's answers are checked here, before the pipeline reads them, so a
 * malformed answer is treated as an unknown outcome and never as a decision.
 */

/** The Warden answered a request with a client error and did not act on it, so nothing reached the ledger. */
export class DefinitiveRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitiveRefusal';
  }
}

export interface WardenPort {
  propose(proposal: PaymentProposal): Promise<ProposeResult>;
  coSign(attemptId: string, signedBlob: string): Promise<CoSignResult>;
}

/** The calls the HTTP client offers. The client satisfies it, and tests can stand in for it. */
export interface WardenRpc {
  propose(proposal: unknown): Promise<unknown>;
  coSign(attemptId: string, signedBlob: string): Promise<unknown>;
}

const OUTCOMES = [
  'paid',
  'failed',
  'rejected',
  'expired',
  'held',
  'pending',
] as const satisfies readonly Outcome[];

const ProposeAnswer = z.strictObject({
  attemptId: z.uuid().nullable(),
  decision: WardenDecision,
  toCoSign: z.string().min(2).max(20_000).nullable(),
});

const CoSignAnswer = z.strictObject({
  attemptId: z.uuid(),
  outcome: z.enum(OUTCOMES),
  hash: z.string().max(200),
  ledgerIndex: z.int().min(1).nullable(),
  engineResult: z.string().max(40).nullable(),
});

function classify(error: unknown): Error {
  if (error instanceof ClientError && error.status >= 400 && error.status < 500) {
    return new DefinitiveRefusal(error.message);
  }
  return error instanceof Error ? error : new Error('the Warden request failed');
}

/** Adapts the HTTP client. A non-answer or a malformed answer is an error, which the pipeline treats as unknown. */
export function wardenPortOf(rpc: WardenRpc): WardenPort {
  return {
    async propose(proposal) {
      const answer = await rpc.propose(proposal).catch((error: unknown) => {
        throw classify(error);
      });
      const parsed = ProposeAnswer.safeParse(answer);
      if (!parsed.success) {
        throw new Error('the Warden answer did not match the contract');
      }
      return parsed.data;
    },
    async coSign(attemptId, signedBlob) {
      const answer = await rpc.coSign(attemptId, signedBlob).catch((error: unknown) => {
        throw classify(error);
      });
      const parsed = CoSignAnswer.safeParse(answer);
      if (!parsed.success) {
        throw new Error('the Warden answer did not match the contract');
      }
      return parsed.data;
    },
  };
}
