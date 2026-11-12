import { decode } from 'xrpl';
import { describe, expect, it } from 'vitest';

import { LSF_DISABLE_MASTER, signerAccounts } from '../../../packages/xrpl/src/index.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import type { Base } from './helpers/world.js';
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

/**
 * P0 regression (issue #45): an artifact handed to the agent before a later operator action must be
 * useless afterwards. Each test captures the agent's real reply from propose(), changes one fact, then
 * proves that Warden refuses finalization AND that the agent cannot submit the captured artifact alone.
 */

/** A ledger port whose spending account can be made to look as if its signer configuration changed. */
function armableSpendingPort(base: Base) {
  let armed = false;
  const port = {
    ...base.port,
    account: async (address: string) => {
      const snapshot = await base.port.account(address);
      if (!armed || snapshot === null || address !== base.spending.address) {
        return snapshot;
      }
      return { ...snapshot, flags: snapshot.flags & ~LSF_DISABLE_MASTER };
    },
  };
  return { port, arm: (): void => void (armed = true) };
}

async function activeSupplier(
  service: Awaited<ReturnType<typeof openService>>,
  base: Base,
  publicKey: string,
): Promise<void> {
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: base.supplierAccount.address, destinationTag: null },
      publicKey,
    },
    'first-operator',
  );
  await service.approveSupplier(SUPPLIER, 'second-operator');
}

describe('P0 earlier artifacts are useless after later operator and ledger changes', () => {
  it('refuses an earlier artifact after a limit is lowered, and the agent cannot submit it alone', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const answer = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    expect(answer.decision.decision).toBe('ALLOW');
    const agentOnly = coSignAsAgent(base.agentWallet, answer.toCoSign ?? '');

    const version = await service.setLimits({ perPaymentMinor: 500 }, 'first-operator');
    expect(version).not.toBe(config.policyVersion);

    await expect(service.coSign(attemptId, agentOnly)).rejects.toThrow('policy changed');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
    const attempted = await base.port.submit(agentOnly);
    expect(attempted.engineResult).toBe('tefBAD_QUORUM');
  });

  it('refuses an earlier artifact once the spending account signer configuration changes', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const altered = armableSpendingPort(base);
    const service = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      port: altered.port,
    });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const answer = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    expect(answer.decision.decision).toBe('ALLOW');
    const agentOnly = coSignAsAgent(base.agentWallet, answer.toCoSign ?? '');
    expect(signerAccounts(agentOnly)).toEqual([base.agent.address]);

    altered.arm();

    await expect(service.coSign(attemptId, agentOnly)).rejects.toThrow(
      'the ledger no longer permits this payment',
    );
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
    const attempted = await base.port.submit(agentOnly);
    expect(attempted.engineResult).toBe('tefBAD_QUORUM');
  });

  it('never returns a Warden signature in the artifact, so the captured reply carries one signer at most', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const answer = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(answer.decision.decision).toBe('ALLOW');
    const fields = decode(answer.toCoSign ?? '') as { Signers?: unknown[] };
    expect(fields.Signers).toBeUndefined();
    expect(signerAccounts(answer.toCoSign ?? '')).not.toContain(base.warden.address);
  });
});
