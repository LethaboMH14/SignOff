import { sign, type KeyObject } from 'node:crypto';

import { decode } from 'xrpl';
import { describe, expect, it } from 'vitest';

import { signerAccounts } from '../../../packages/xrpl/src/index.js';
import { canonicalJson } from '../src/canonical.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import type { WardenService } from '../src/service.js';
import {
  configFor,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  proposalFor,
  provisionedBase,
  STANDARD,
  SUPPLIER,
  type Base,
  type Clock,
} from './helpers/world.js';

const OPERATOR_A = 'first-operator';
const OPERATOR_B = 'second-operator';

/** Enrols and approves the supplier, so a proposal can be prepared for it. */
async function activeSupplier(
  base: Base,
  service: WardenService,
  publicKey: string,
): Promise<void> {
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: base.supplierAccount.address, destinationTag: null },
      publicKey,
    },
    OPERATOR_A,
  );
  await service.approveSupplier(SUPPLIER, OPERATOR_B);
}

/** A payout change request, signed by the supplier key as the Warden expects. */
function signedChange(privateKey: KeyObject, newAddress: string, nonce: string, at: Date) {
  const request = {
    supplierId: SUPPLIER,
    newPayee: { address: newAddress, destinationTag: null },
    newPublicKey: null,
    requestedAt: at.toISOString(),
    nonce,
  };
  const signature = sign(null, Buffer.from(canonicalJson(request), 'utf8'), privateKey).toString(
    'base64',
  );
  return { request, signature };
}

/**
 * Regression tests for issue #45 (P0). The proposal returns only UNSIGNED prepared terms. The agent can sign its own
 * half, but no usable Warden signature exists until coSign has re-run every final check. Each test captures a
 * prepared proposal, changes one thing the Warden must re-check, and then asserts that the agent's co-signature is
 * refused and that the agent cannot submit the captured transaction alone.
 */
describe('P0 independent Warden signing boundary (issue #45)', () => {
  async function prepared(): Promise<{
    readonly base: Base;
    readonly clock: Clock;
    readonly service: WardenService;
    readonly id: string;
    readonly agentOnly: string;
    readonly supplierKey: ReturnType<typeof generateSupplierKey>;
  }> {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const supplierKey = generateSupplierKey();
    await activeSupplier(base, service, supplierKey.publicKey);
    const id = newAttemptId();
    const answer = await service.propose(proposalFor(id, STANDARD, config, clock.now));
    expect(answer.decision.decision).toBe('ALLOW');
    const toCoSign = answer.toCoSign ?? '';
    const decoded = decode(toCoSign) as { Signers?: unknown[] };
    expect(decoded.Signers).toBeUndefined();
    const agentOnly = coSignAsAgent(base.agentWallet, toCoSign);
    expect(signerAccounts(agentOnly)).toEqual([base.agent.address]);
    return { base, clock, service, id, agentOnly, supplierKey };
  }

  it('a captured proposal cannot be broadcast by the agent alone, including after STOP', async () => {
    const { base, service, id, agentOnly } = await prepared();

    await service.setPaused(true, OPERATOR_A);
    const attempted = await base.port.submit(agentOnly);
    expect(attempted.engineResult).toBe('tefBAD_QUORUM');
    await expect(service.coSign(id, agentOnly)).rejects.toThrow('paused');
    expect(service.attempt(id)?.status).toBe('awaiting');
  });

  it('a captured proposal is refused after a limit is lowered, and the agent cannot submit it alone', async () => {
    const { base, service, id, agentOnly } = await prepared();

    const lowered = await service.setLimits({ perPaymentMinor: 500 }, OPERATOR_A);
    expect(lowered).toMatchObject({ applied: true });
    await expect(service.coSign(id, agentOnly)).rejects.toThrow('policy changed');
    expect(service.attempt(id)?.status).toBe('awaiting');
    const attempted = await base.port.submit(agentOnly);
    expect(attempted.engineResult).toBe('tefBAD_QUORUM');
  });

  it('a captured proposal is refused once a payout change is requested for the supplier', async () => {
    const { base, clock, service, id, agentOnly, supplierKey } = await prepared();

    const change = signedChange(
      supplierKey.privateKey,
      base.supplierAccount.address,
      'nonce-issue-45-payout',
      clock.now,
    );
    await service.requestChange(SUPPLIER, change.request, change.signature);
    await expect(service.coSign(id, agentOnly)).rejects.toThrow('payout details are changing');
    expect(service.attempt(id)?.status).toBe('awaiting');
    const attempted = await base.port.submit(agentOnly);
    expect(attempted.engineResult).toBe('tefBAD_QUORUM');
  });
});
