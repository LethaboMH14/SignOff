import { describe, expect, it } from 'vitest';

import { ClientError } from '../../../../packages/warden-api/src/client.js';
import { DefinitiveRefusal, wardenPortOf, type WardenRpc } from '../../src/workflow/warden-port.js';
import { ATTEMPT, HASH, POLICY } from '../support/world.js';

const DECISION = {
  schemaVersion: 1,
  proposalFingerprint: 'b'.repeat(64),
  policyVersion: POLICY,
  evaluatedAt: '2026-11-10T10:00:00.000Z',
  decision: 'ALLOW',
  reasons: [],
};

const PROPOSAL = {
  schemaVersion: 1,
  obligationKey: 'd'.repeat(64),
  attemptId: ATTEMPT,
  supplierId: 'SUP-TST001',
  currency: 'ZAR',
  amountMinor: 1,
  invoiceFingerprint: 'a'.repeat(64),
  policyVersion: POLICY,
  proposedBy: 'agent',
  proposedAt: '2026-11-10T10:00:00.000Z',
} as const;

function rpcWith(overrides: Partial<WardenRpc> = {}): WardenRpc {
  return {
    propose: () => Promise.resolve({ attemptId: ATTEMPT, decision: DECISION, toCoSign: 'AB' }),
    coSign: () =>
      Promise.resolve({
        attemptId: ATTEMPT,
        outcome: 'paid',
        hash: HASH,
        ledgerIndex: 9,
        engineResult: 'tesSUCCESS',
      }),
    ...overrides,
  };
}

describe('wardenPortOf', () => {
  it('returns a well-formed propose answer unchanged', async () => {
    const port = wardenPortOf(rpcWith());
    const answer = await port.propose(PROPOSAL);
    expect(answer).toEqual({ attemptId: ATTEMPT, decision: DECISION, toCoSign: 'AB' });
  });

  it('returns a well-formed co-sign answer unchanged', async () => {
    const answer = await wardenPortOf(rpcWith()).coSign(ATTEMPT, 'blob');
    expect(answer).toMatchObject({ outcome: 'paid', hash: HASH });
  });

  it('treats a malformed propose answer as an error, not as a decision', async () => {
    const port = wardenPortOf(rpcWith({ propose: () => Promise.resolve({ decision: 'ALLOW' }) }));
    await expect(port.propose(PROPOSAL)).rejects.toThrow('did not match the contract');
  });

  it('treats a malformed co-sign answer as an error, not as an outcome', async () => {
    const port = wardenPortOf(rpcWith({ coSign: () => Promise.resolve({ outcome: 'paid' }) }));
    await expect(port.coSign(ATTEMPT, 'blob')).rejects.toThrow('did not match the contract');
  });

  it('turns a client error from the Warden into a refusal the agent can read', async () => {
    const port = wardenPortOf(
      rpcWith({ propose: () => Promise.reject(new ClientError(422, 'the proposal is not valid')) }),
    );
    const error: unknown = await port.propose(PROPOSAL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DefinitiveRefusal);
    expect((error as Error).message).toBe('the proposal is not valid');
  });

  it('keeps a server error or a network error as an unknown outcome', async () => {
    const server = wardenPortOf(
      rpcWith({ coSign: () => Promise.reject(new ClientError(503, 'paused')) }),
    );
    const serverError: unknown = await server
      .coSign(ATTEMPT, 'blob')
      .catch((caught: unknown) => caught);
    expect(serverError).toBeInstanceOf(ClientError);

    const network = wardenPortOf(
      rpcWith({ propose: () => Promise.reject(new Error('socket closed')) }),
    );
    const networkError: unknown = await network
      .propose(PROPOSAL)
      .catch((caught: unknown) => caught);
    // An error from the transport passes through unchanged, so the pipeline can see it was not a refusal.
    expect(networkError).toBeInstanceOf(Error);
    expect((networkError as Error).message).toBe('socket closed');
    expect(networkError).not.toBeInstanceOf(DefinitiveRefusal);
  });
});
