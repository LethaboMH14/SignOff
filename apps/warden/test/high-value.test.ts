import { describe, expect, it } from 'vitest';
import { decode, Wallet, type Transaction } from 'xrpl';

import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { OwnerApprovalError, type OwnerApprover } from '../src/owner-approval.js';
import { WardenError } from '../src/service.js';
import {
  configFor,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  provisionedBase,
  proposalFor,
  STANDARD,
  SUPPLIER,
  type Base,
} from './helpers/world.js';

/*
 * The high-value route: at or above the threshold, the payment comes from an account whose signer list is agent,
 * Warden and owner, quorum 3. The fake ledger checks signer lists as the real one does, so a payment missing the
 * owner's signature is refused by the ledger, not only by the Warden. Here the spending account plays the
 * high-value account, with its signer list changed to the three-signer list.
 */

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';

interface World {
  readonly base: Base;
  readonly owner: Wallet;
  readonly config: ReturnType<typeof configFor>;
  readonly clock: ReturnType<typeof newClock>;
  readonly service: Awaited<ReturnType<typeof openService>>;
}

/** The owner's phone, simulated: signs whatever it is asked to, as the owner, unless told to reject. */
function phoneOf(owner: Wallet, behaviour: 'approve' | 'reject' | 'wrong-signer' = 'approve') {
  const requests: Readonly<Record<string, unknown>>[] = [];
  const approver: OwnerApprover = {
    collect(request) {
      requests.push(request.transaction);
      if (behaviour === 'reject') {
        return Promise.reject(new OwnerApprovalError('rejected', 'the owner rejected the payment'));
      }
      const signer = behaviour === 'wrong-signer' ? Wallet.generate() : owner;
      return Promise.resolve(
        signer.sign(request.transaction as unknown as Transaction, true).tx_blob,
      );
    },
  };
  return { approver, requests };
}

async function world(
  options: {
    readonly phone?: 'approve' | 'reject' | 'wrong-signer';
    readonly thresholdMinor?: number;
    readonly ownerOnList?: boolean;
  } = {},
): Promise<World & { readonly requests: readonly unknown[] }> {
  const base = await provisionedBase();
  const owner = Wallet.generate();
  base.ledger.fund(owner);
  const treasury = base.ledger.account(base.spending.address);
  if (treasury === undefined) {
    throw new Error('the spending account is missing from the fake ledger');
  }
  if (options.ownerOnList !== false) {
    treasury.signerList = {
      quorum: 3,
      entries: [
        { account: base.agent.address, weight: 1 },
        { account: base.warden.address, weight: 1 },
        { account: owner.address, weight: 1 },
      ],
    };
  }
  const config = configFor(base, {
    highValue: {
      thresholdMinor: options.thresholdMinor ?? 500,
      treasuryAddress: base.spending.address,
      ownerAddress: owner.address,
      approvalWindowLedgers: 300,
    },
  });
  const clock = newClock();
  const phone = options.phone === undefined ? undefined : phoneOf(owner, options.phone);
  const service = await openService(base, config, evidenceFrom([STANDARD]), {
    clock,
    ...(phone === undefined ? {} : { ownerApprover: phone.approver }),
  });
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: base.supplierAccount.address, destinationTag: null },
      publicKey: generateSupplierKey().publicKey,
    },
    OPERATOR_A,
  );
  await service.approveSupplier(SUPPLIER, OPERATOR_B);
  return { base, owner, config, clock, service, requests: phone?.requests ?? [] };
}

async function proposeAndAgentSign(w: World) {
  const attemptId = newAttemptId();
  const reply = await w.service.propose(proposalFor(attemptId, STANDARD, w.config, w.clock.now));
  const agentBlob =
    reply.toCoSign === null ? null : coSignAsAgent(w.base.agentWallet, reply.toCoSign);
  return { attemptId, reply, agentBlob };
}

describe('the high-value route', () => {
  it('pays only with the owner signature, and the ledger shows three signers', async () => {
    const w = await world({ phone: 'approve' });
    const { attemptId, reply, agentBlob } = await proposeAndAgentSign(w);
    expect(reply.decision.decision).toBe('ALLOW');
    const result = await w.service.coSign(attemptId, agentBlob ?? '');
    expect(result.outcome).toBe('paid');
    expect(w.requests).toHaveLength(1);
    expect(w.base.ledger.validated(result.hash)?.engineResult).toBe('tesSUCCESS');
    const finalBlob = w.service.attempt(attemptId)?.finalBlob ?? '';
    const signers = (decode(finalBlob) as { Signers?: unknown[] }).Signers ?? [];
    expect(signers).toHaveLength(3);
  });

  it('gives the payment a longer expiry so a person has time to approve', async () => {
    const w = await world({ phone: 'approve' });
    const { reply } = await proposeAndAgentSign(w);
    const prepared = decode(reply.toCoSign ?? '') as { LastLedgerSequence?: number };
    expect(prepared.LastLedgerSequence ?? 0).toBeGreaterThan(w.base.ledger.validatedIndex + 300);
  });

  it('holds a high-value payment when owner approval is not set up', async () => {
    const w = await world();
    const { reply } = await proposeAndAgentSign(w);
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('OWNER_APPROVAL_UNAVAILABLE');
    expect(reply.toCoSign).toBeNull();
  });

  it('sends nothing when the owner rejects, and frees the payable', async () => {
    const w = await world({ phone: 'reject' });
    const { attemptId, agentBlob } = await proposeAndAgentSign(w);
    await expect(w.service.coSign(attemptId, agentBlob ?? '')).rejects.toThrow(WardenError);
    expect(w.service.attempt(attemptId)?.status).toBe('expired');
    const again = await proposeAndAgentSign(w);
    expect(again.reply.decision.decision).toBe('ALLOW');
  });

  it('refuses a phone signature from anyone but the owner', async () => {
    const w = await world({ phone: 'wrong-signer' });
    const { attemptId, agentBlob } = await proposeAndAgentSign(w);
    await expect(w.service.coSign(attemptId, agentBlob ?? '')).rejects.toThrow(
      'only the owner signature',
    );
    expect(w.service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('holds when the high-value account does not require the owner on the ledger', async () => {
    const w = await world({ phone: 'approve', ownerOnList: false });
    const { reply } = await proposeAndAgentSign(w);
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('SIGNER_CHANGE_NOT_APPROVED');
  });

  it('keeps payments below the threshold on the two-signature route, without asking the owner', async () => {
    const base = await provisionedBase();
    const owner = Wallet.generate();
    const requests: unknown[] = [];
    const config = configFor(base, {
      highValue: {
        thresholdMinor: 1_000_000,
        treasuryAddress: base.spending.address,
        ownerAddress: owner.address,
        approvalWindowLedgers: 300,
      },
    });
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      ownerApprover: {
        collect: (request) => {
          requests.push(request);
          return Promise.reject(new Error('should not be asked'));
        },
      },
    });
    await service.enrolSupplier(
      {
        supplierId: SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: generateSupplierKey().publicKey,
      },
      OPERATOR_A,
    );
    await service.approveSupplier(SUPPLIER, OPERATOR_B);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const result = await service.coSign(
      attemptId,
      coSignAsAgent(base.agentWallet, reply.toCoSign ?? ''),
    );
    expect(result.outcome).toBe('paid');
    expect(requests).toHaveLength(0);
  });
});

describe('the high-value answer to the agent', () => {
  it('tells the agent that the owner must sign before the Warden co-signs', async () => {
    const w = await world({ phone: 'approve' });
    const { reply } = await proposeAndAgentSign(w);
    expect(reply.decision).toMatchObject({ decision: 'ALLOW', ownerApprovalRequired: true });
  });

  it('does not ask for the owner on a routine payment', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      highValue: {
        thresholdMinor: 1_000_000,
        treasuryAddress: base.spending.address,
        ownerAddress: Wallet.generate().address,
        approvalWindowLedgers: 300,
      },
    });
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await service.enrolSupplier(
      {
        supplierId: SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: generateSupplierKey().publicKey,
      },
      OPERATOR_A,
    );
    await service.approveSupplier(SUPPLIER, OPERATOR_B);
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('ALLOW');
    expect(reply.decision).not.toHaveProperty('ownerApprovalRequired');
  });
});
