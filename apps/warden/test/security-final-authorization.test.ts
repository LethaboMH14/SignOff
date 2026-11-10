import { decode } from 'xrpl';
import { describe, expect, it } from 'vitest';

import { signerAccounts } from '../../../packages/xrpl/src/index.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
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
} from './helpers/world.js';

describe('P0 independent Warden signing boundary', () => {
  it('a captured proposal cannot be broadcast by the agent alone, including after STOP', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const key = generateSupplierKey();
    await service.enrolSupplier(
      {
        supplierId: SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: key.publicKey,
      },
      'first-operator',
    );
    await service.approveSupplier(SUPPLIER, 'second-operator');
    const id = newAttemptId();
    const answer = await service.propose(proposalFor(id, STANDARD, config, clock.now));
    expect(answer.decision.decision).toBe('ALLOW');

    const prepared = decode(answer.toCoSign ?? '') as { Signers?: unknown[] };
    expect(prepared.Signers).toBeUndefined();
    const agentOnly = coSignAsAgent(base.agentWallet, answer.toCoSign ?? '');
    expect(signerAccounts(agentOnly)).toEqual([base.agent.address]);

    await service.setPaused(true, 'first-operator');
    const attempted = await base.port.submit(agentOnly);
    expect(attempted.engineResult).toBe('tefBAD_QUORUM');
    await expect(service.coSign(id, agentOnly)).rejects.toThrow('paused');
    expect(service.attempt(id)?.status).toBe('awaiting');
  });
});
