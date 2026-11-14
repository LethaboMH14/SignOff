import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';

import { canonicalJson, sha256Hex } from '../src/canonical.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { memoryEventLog, type WardenEvent } from '../src/events.js';
import { WardenError, type WardenService } from '../src/service.js';
import {
  configFor,
  entry,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  provisionedBase,
  proposalFor,
  START,
  STANDARD,
  SUPPLIER,
  OTHER_SUPPLIER,
  type Base,
} from './helpers/world.js';

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';

function spkiOf(keys: KeyObject): string {
  return keys.export({ format: 'der', type: 'spki' }).toString('base64');
}

function signedChange(
  privateKey: KeyObject,
  supplierId: string,
  newAddress: string,
  nonce: string,
  requestedAt: Date,
) {
  const request = {
    supplierId,
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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('the call was expected to be refused');
}

describe('inputs that do not match their schema', () => {
  it('refuses a proposal that does not match the schema, names no attempt, and signs nothing', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([STANDARD]), {
      clock: newClock(),
    });
    for (const raw of [{}, undefined, 'a string']) {
      const reply = await service.propose(raw);
      expect(reply).toMatchObject({
        attemptId: null,
        toCoSign: null,
        decision: { decision: 'REFUSE' },
      });
    }
  });

  it('refuses limits, approvals, supplier enrolment and payout changes that do not match their schema, with a 400', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    for (const failure of [
      service.setLimits({ perPaymentMinor: 0 }, OPERATOR_A),
      service.approveProposal({}, OPERATOR_A),
      service.enrolSupplier({ supplierId: 'bad' }, OPERATOR_A),
      service.requestChange(SUPPLIER, { unexpected: true }, 'AA'),
    ]) {
      expect(await rejection(failure)).toMatchObject({ status: 400 });
    }
  });

  it('refuses an Ed25519 key that is malformed, and a key of another type', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    const x25519 = spkiOf(generateKeyPairSync('x25519').publicKey);
    const payee = { address: base.supplierAccount.address, destinationTag: null };
    expect(
      await rejection(
        service.enrolSupplier({ supplierId: SUPPLIER, payee, publicKey: 'AAAA' }, OPERATOR_A),
      ),
    ).toMatchObject({
      status: 400,
      message: 'the public key is not a valid key',
    });
    expect(
      await rejection(
        service.enrolSupplier({ supplierId: SUPPLIER, payee, publicKey: x25519 }, OPERATOR_A),
      ),
    ).toMatchObject({
      status: 400,
      message: 'the public key must be Ed25519',
    });
  });
});

describe('supplier and payout-change rules at their edges', () => {
  it("refuses a payee that is one of the Warden's own accounts, but not an outside account", async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    const key = generateSupplierKey().publicKey;
    expect(
      await rejection(
        service.enrolSupplier(
          {
            supplierId: SUPPLIER,
            payee: { address: base.warden.address, destinationTag: null },
            publicKey: key,
          },
          OPERATOR_A,
        ),
      ),
    ).toMatchObject({ status: 422 });
  });

  it('refuses a second enrolment of the same supplier, and approval of an unknown or already approved supplier', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    const payee = { address: base.supplierAccount.address, destinationTag: null };
    expect(
      await rejection(
        service.enrolSupplier(
          { supplierId: SUPPLIER, payee, publicKey: generateSupplierKey().publicKey },
          OPERATOR_A,
        ),
      ),
    ).toMatchObject({
      status: 409,
    });
    expect(await rejection(service.approveSupplier(SUPPLIER, OPERATOR_B))).toMatchObject({
      status: 409,
    });
    expect(await rejection(service.approveSupplier('SUP-ZZZZ9999', OPERATOR_B))).toMatchObject({
      status: 404,
    });
  });

  it('refuses a payout change for a supplier that is not active yet, and one that names another supplier in its body', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    const supplier = generateSupplierKey();
    await service.enrolSupplier(
      {
        supplierId: SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: supplier.publicKey,
      },
      OPERATOR_A,
    );
    const { request, signature } = signedChange(
      supplier.privateKey,
      SUPPLIER,
      base.supplierAccount.address,
      'nonce-pending-supplier',
      START,
    );
    expect(await rejection(service.requestChange(SUPPLIER, request, signature))).toMatchObject({
      status: 409,
    });
    expect(
      await rejection(service.requestChange('SUP-ZZZZ9999', request, signature)),
    ).toMatchObject({ status: 400 });
  });

  it('refuses a payout change whose request is not recent, and one whose nonce was already used', async () => {
    const base = await provisionedBase();
    const clock = newClock();
    const config = configFor(base);
    const service = await openService(base, config, evidenceFrom([]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(base, service, supplier.publicKey);
    const old = signedChange(
      supplier.privateKey,
      SUPPLIER,
      base.supplierAccount.address,
      'nonce-old-request-1',
      new Date(START.getTime() - 11 * 60_000),
    );
    expect(
      await rejection(service.requestChange(SUPPLIER, old.request, old.signature)),
    ).toMatchObject({ status: 422, message: 'the change request is not recent' });

    const first = signedChange(
      supplier.privateKey,
      SUPPLIER,
      base.supplierAccount.address,
      'nonce-used-by-change',
      clock.now,
    );
    const changeId = await service.requestChange(SUPPLIER, first.request, first.signature);
    await service.confirmChange(SUPPLIER, changeId, OPERATOR_A);
    await service.approveChange(SUPPLIER, changeId, OPERATOR_B);
    clock.now = new Date(clock.now.getTime() + config.coolingOffMs + 1000);
    // Any proposal runs the due payout changes first, so this one brings the change into effect.
    await service.propose(
      proposalFor(
        newAttemptId(),
        entry({ invoiceNumber: 'INV-080', fingerprint: sha256Hex('i-080') }),
        config,
        clock.now,
      ),
    );
    const reused = signedChange(
      supplier.privateKey,
      SUPPLIER,
      base.supplierAccount.address,
      'nonce-used-by-change',
      clock.now,
    );
    expect(
      await rejection(service.requestChange(SUPPLIER, reused.request, reused.signature)),
    ).toMatchObject({
      status: 422,
      message: 'the change request was already used',
    });
  });

  it('refuses to confirm a change twice, and refuses approval to a payee the identity check does not verify', async () => {
    const base = await provisionedBase();
    const clock = newClock();
    const config = configFor(base, { verifiedPayees: [base.supplierAccount.address] });
    const service = await openService(base, config, evidenceFrom([]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(base, service, supplier.publicKey);
    const unverified = Wallet.generate().address;
    const { request, signature } = signedChange(
      supplier.privateKey,
      SUPPLIER,
      unverified,
      'nonce-unverified-1',
      clock.now,
    );
    const changeId = await service.requestChange(SUPPLIER, request, signature);
    await service.confirmChange(SUPPLIER, changeId, OPERATOR_A);
    expect(await rejection(service.confirmChange(SUPPLIER, changeId, OPERATOR_B))).toMatchObject({
      status: 409,
    });
    expect(await rejection(service.approveChange(SUPPLIER, changeId, OPERATOR_B))).toMatchObject({
      status: 422,
      message: 'the identity check did not verify the new payee',
    });
  });

  it('refuses confirmation or approval of a change that does not exist', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    const unknown = randomUUID();
    expect(await rejection(service.confirmChange(SUPPLIER, unknown, OPERATOR_A))).toMatchObject({
      status: 404,
    });
    expect(await rejection(service.approveChange(SUPPLIER, unknown, OPERATOR_B))).toMatchObject({
      status: 404,
    });
    expect(
      await rejection(service.confirmChange('SUP-ZZZZ9999', unknown, OPERATOR_A)),
    ).toMatchObject({ status: 404 });
  });
});

describe('proposals that disagree with the invoice', () => {
  it('refuses a proposal whose obligation identity does not match the invoice', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    const proposal = {
      ...proposalFor(newAttemptId(), STANDARD, config, clock.now),
      obligationKey: 'f'.repeat(64),
    };
    const reply = await service.propose(proposal);
    expect(reply.decision).toMatchObject({
      decision: 'REFUSE',
      reasons: [{ code: 'INVARIANT_FAILED' }],
    });
  });

  it('holds a proposal whose amount is not the invoice amount', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    const reply = await service.propose({
      ...proposalFor(newAttemptId(), STANDARD, config, clock.now),
      amountMinor: 999,
    });
    expect(reply.decision).toMatchObject({
      decision: 'HOLD',
      reasons: [{ code: 'AMOUNT_MISMATCH' }],
    });
  });

  it("refuses a proposal that names a supplier other than the invoice's supplier", async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    await service.enrolSupplier(
      {
        supplierId: OTHER_SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: generateSupplierKey().publicKey,
      },
      OPERATOR_A,
    );
    await service.approveSupplier(OTHER_SUPPLIER, OPERATOR_B);
    const reply = await service.propose(
      proposalFor(newAttemptId(), STANDARD, config, clock.now, OTHER_SUPPLIER),
    );
    expect(reply.decision).toMatchObject({
      decision: 'REFUSE',
      reasons: [{ code: 'INVARIANT_FAILED' }],
    });
  });

  it('holds an invoice that names no purchase order', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const unordered = entry({
      invoiceNumber: 'INV-090',
      fingerprint: sha256Hex('invoice-090'),
      purchaseOrderId: null,
      order: null,
      receivedMinor: null,
    });
    const service = await openService(base, config, evidenceFrom([unordered]), { clock });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), unordered, config, clock.now));
    expect(reply.decision).toMatchObject({
      decision: 'HOLD',
      reasons: [{ code: 'MISSING_EVIDENCE' }],
    });
  });
});

describe('submissions with an unknown outcome, and stored records that are damaged', () => {
  it('keeps a submission with an unknown outcome reserved, and pays the identical transaction once after a restart', async () => {
    const base = await provisionedBase();
    const clock = newClock();
    const log = memoryEventLog();
    const config = configFor(base, { submission: { pollMs: 0, maxPolls: 3 } });
    const offline = {
      ...base.port,
      submit: () => Promise.reject(new Error('the network is down')),
    };
    const first = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      log,
      port: offline,
    });
    await activeSupplier(base, first, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await first.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const outcome = await first.coSign(
      attemptId,
      coSignAsAgent(base.agentWallet, reply.toCoSign ?? ''),
    );
    expect(outcome.outcome).toBe('pending');
    expect(first.attempt(attemptId)?.status).toBe('submitting');
    // While the outcome is unknown the payable stays reserved, so a second proposal for it is held.
    const second = await first.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(second.decision).toMatchObject({ decision: 'HOLD', reasons: [{ code: 'DUPLICATE' }] });

    const restarted = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
    await restarted.recover();
    expect(restarted.attempt(attemptId)?.status).toBe('paid');
    expect(
      base.ledger
        .line(base.supplierAccount.address, 'TST', base.issuer.address)
        ?.balance.toString(),
    ).toBe('10');
  });

  it('refuses to co-sign an attempt whose stored record is damaged, and signs nothing', async () => {
    const base = await provisionedBase();
    const clock = newClock();
    const attemptId = newAttemptId();
    const decision = {
      schemaVersion: 1,
      proposalFingerprint: sha256Hex('p'),
      policyVersion: '2026-11-10.1',
      evaluatedAt: START.toISOString(),
      decision: 'ALLOW',
      reasons: [],
    };
    const damaged = (txFields: string): WardenEvent[] => [
      {
        type: 'supplier.enrolled',
        at: START.toISOString(),
        supplierId: SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: generateSupplierKey().publicKey,
        enrolledBy: OPERATOR_A,
        identityReference: 'simulated-identity:0123',
      },
      {
        type: 'supplier.approved',
        at: START.toISOString(),
        supplierId: SUPPLIER,
        approvedBy: OPERATOR_B,
      },
      {
        type: 'attempt.awaiting',
        at: START.toISOString(),
        attemptId,
        scopedKey: sha256Hex('scoped'),
        obligationKey: sha256Hex('obligation'),
        invoiceFingerprint: sha256Hex('invoice'),
        supplierId: SUPPLIER,
        currency: 'USD',
        ledgerCurrency: 'TST',
        issuer: base.issuer.address,
        amountMinor: 1000,
        attemptNumber: 1,
        lastLedgerSequence: 999_999,
        txFields,
        wardenBlob: 'AABB',
        decision,
      } as WardenEvent,
    ];
    for (const [txFields, message] of [
      ['[]', 'not a transaction'],
      ['{}', 'damaged'],
    ] as const) {
      const log = memoryEventLog();
      for (const event of damaged(txFields)) {
        await log.append(event);
      }
      const service = await openService(base, configFor(base), evidenceFrom([]), { clock, log });
      await expect(service.coSign(attemptId, 'AABB')).rejects.toThrow(message);
      expect(service.attempt(attemptId)?.status).toBe('awaiting');
    }
  });

  it('refuses a co-signature that does not decode as a transaction', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(base, service, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    expect(await rejection(service.coSign(attemptId, 'AABB'))).toBeInstanceOf(WardenError);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });
});
