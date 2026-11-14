import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { decode, Wallet, type SubmittableTransaction } from 'xrpl';
import { describe, expect, it } from 'vitest';

import {
  combineSigned,
  hashOfSigned,
  LSF_DISABLE_MASTER,
  signAsSigner,
} from '../../../packages/xrpl/src/index.js';
import { TEST_TOKEN_CURRENCY } from '../../../packages/xrpl/src/constants.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { canonicalJson, sha256Hex } from '../src/canonical.js';
import type { WardenConfig } from '../src/config.js';
import { memoryEventLog } from '../src/events.js';
import { WardenError, WardenService } from '../src/service.js';
import {
  configFor,
  entry,
  evidenceFrom,
  newAttemptId,
  newClock,
  fundedPayee,
  openService,
  provisionedBase,
  proposalFor,
  START,
  STANDARD,
  SUPPLIER,
  type Base,
  type Clock,
  type InvoiceEntry,
} from './helpers/world.js';

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';

function balanceOf(base: Base, holder: string): string {
  return (
    base.ledger.line(holder, TEST_TOKEN_CURRENCY, base.issuer.address)?.balance.toString() ?? 'none'
  );
}

function spkiOf(keys: KeyObject): string {
  return keys.export({ format: 'der', type: 'spki' }).toString('base64');
}

/** Enrols and approves the supplier with the supplier's own key, as the operator process does. */
async function activeSupplier(
  service: WardenService,
  base: Base,
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

/** Proposes an entry and, if allowed, runs the agent's co-signature and the Warden's submission. */
async function pay(
  service: WardenService,
  base: Base,
  config: WardenConfig,
  item: InvoiceEntry,
  clock: Clock,
  attemptId = newAttemptId(),
) {
  const reply = await service.propose(proposalFor(attemptId, item, config, clock.now));
  if (reply.toCoSign === null) {
    return { reply, outcome: null };
  }
  const outcome = await service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign));
  return { reply, outcome };
}

/** A payout-change request signed with the supplier's current key. */
function signedChange(privateKey: KeyObject, newAddress: string, nonce: string, requestedAt: Date) {
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

describe('P0 final Warden authorization boundary', () => {
  it('never releases the Warden signature on an allowed proposal, so direct agent broadcast fails', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const proposed = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    expect(proposed.decision.decision).toBe('ALLOW');
    const unsigned = decode(proposed.toCoSign ?? '') as { Signers?: unknown[] };
    expect(unsigned.Signers).toBeUndefined();
    const agentOnly = coSignAsAgent(base.agentWallet, proposed.toCoSign ?? '');
    const result = await base.port.submit(agentOnly);
    expect(result.engineResult).toBe('tefBAD_QUORUM');
    await service.setPaused(true, OPERATOR_A);
    await expect(service.coSign(attemptId, agentOnly)).rejects.toThrow('paused');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
    expect(balanceOf(base, base.supplierAccount.address)).not.toBe('10');
  });

  it('refuses to finalize a payment if the policy changed after preparation', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const proposed = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const agentOnly = coSignAsAgent(base.agentWallet, proposed.toCoSign ?? '');
    await service.setLimits({ perPaymentMinor: 500 }, OPERATOR_A);
    await expect(service.coSign(attemptId, agentOnly)).rejects.toThrow('policy changed');
    expect(balanceOf(base, base.supplierAccount.address)).not.toBe('10');
  });

  it('rechecks a changed ledger freeze state immediately before Warden signs', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const proposed = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const agentOnly = coSignAsAgent(base.agentWallet, proposed.toCoSign ?? '');
    base.ledger.setLineFrozen(
      base.spending.address,
      TEST_TOKEN_CURRENCY,
      base.issuer.address,
      true,
    );
    await expect(service.coSign(attemptId, agentOnly)).rejects.toThrow('ledger no longer permits');
    expect(balanceOf(base, base.supplierAccount.address)).not.toBe('10');
  });
});

describe('B1 proposals, co-signature and submission', () => {
  it('pays a proposal that passes every rule: the Warden signs, the agent co-signs, the Warden submits', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('ALLOW');
    expect(reply.toCoSign).toMatch(/^[0-9A-F]+$/);
    const outcome = await service.coSign(
      attemptId,
      coSignAsAgent(base.agentWallet, reply.toCoSign ?? ''),
    );
    expect(outcome.outcome).toBe('paid');
    expect(outcome.ledgerIndex).not.toBeNull();
    expect(balanceOf(base, base.supplierAccount.address)).toBe('10');
    expect(service.attempt(attemptId)?.status).toBe('paid');
  });

  it('refuses a proposal from a supplier that is not approved', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('REFUSE');
    expect(reply.decision.reasons[0]?.code).toBe('SUPPLIER_NOT_APPROVED');
    expect(reply.toCoSign).toBeNull();
  });

  it('refuses a co-signature for a transaction the Warden did not prepare', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const fields: Record<string, unknown> = { ...decode(reply.toCoSign ?? '') };
    delete fields['Signers'];
    fields['Amount'] = {
      currency: TEST_TOKEN_CURRENCY,
      issuer: base.issuer.address,
      value: '1000',
    };
    const altered = signAsSigner(base.agentWallet, fields as unknown as SubmittableTransaction);
    await expect(service.coSign(attemptId, altered)).rejects.toThrow(WardenError);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('refuses a co-signature that the agent alone signed, and a transaction that is not a payment', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    await expect(service.coSign(attemptId, reply.toCoSign ?? '')).rejects.toThrow(WardenError);
    const accountSet = signAsSigner(base.agentWallet, {
      TransactionType: 'AccountSet',
      Account: base.spending.address,
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 99,
      SigningPubKey: '',
    } as unknown as SubmittableTransaction);
    await expect(service.coSign(attemptId, accountSet)).rejects.toThrow(WardenError);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('refuses a second co-signature once the attempt has settled', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const { reply, outcome } = await pay(service, base, config, STANDARD, clock);
    expect(outcome?.outcome).toBe('paid');
    await expect(service.coSign(reply.attemptId ?? '', reply.toCoSign ?? '')).rejects.toThrow(
      WardenError,
    );
  });

  it('refuses a co-signature while payments are paused, submits nothing, and pays after resume', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const agentBlob = coSignAsAgent(base.agentWallet, reply.toCoSign ?? '');
    await service.setPaused(true, OPERATOR_A);
    await expect(service.coSign(attemptId, agentBlob)).rejects.toThrow('paused');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
    expect(balanceOf(base, base.supplierAccount.address)).not.toBe('10');
    await service.setPaused(false, OPERATOR_A);
    const outcome = await service.coSign(attemptId, agentBlob);
    expect(outcome.outcome).toBe('paid');
  });

  it('refuses a co-signature once a payout change is requested for the payee', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      verifiedPayees: [base.supplierAccount.address, Wallet.generate().address],
    });
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const { request, signature } = signedChange(
      supplier.privateKey,
      Wallet.generate().address,
      'nonce-cosign-0001',
      clock.now,
    );
    await service.requestChange(SUPPLIER, request, signature);
    await expect(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    ).rejects.toThrow('changing');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('refuses a co-signature for an attempt whose payee has since changed', async () => {
    const base = await provisionedBase();
    const newAddress = await fundedPayee(base);
    const config = configFor(base, { verifiedPayees: [base.supplierAccount.address, newAddress] });
    const clock = newClock();
    const second = entry({ invoiceNumber: 'INV-061', fingerprint: sha256Hex('invoice-061') });
    const service = await openService(base, config, evidenceFrom([STANDARD, second]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const { request, signature } = signedChange(
      supplier.privateKey,
      newAddress,
      'nonce-applied-0001',
      clock.now,
    );
    const changeId = await service.requestChange(SUPPLIER, request, signature);
    await service.confirmChange(SUPPLIER, changeId, OPERATOR_A);
    await service.approveChange(SUPPLIER, changeId, OPERATOR_B);
    clock.now = new Date(clock.now.getTime() + config.coolingOffMs + 1000);
    await service.propose(proposalFor(newAttemptId(), second, config, clock.now));
    expect(service.supplierPayee(SUPPLIER)?.address).toBe(newAddress);
    await expect(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    ).rejects.toThrow('payee changed');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('treats an attempt whose ledger expiry has passed as expired, and does not co-sign it', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    for (let step = 0; step < 30; step += 1) {
      base.ledger.advance();
    }
    await expect(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    ).rejects.toThrow('expired');
    expect(service.attempt(attemptId)?.status).toBe('expired');
  });

  it('answers a repeated proposal with the same attempt id with the same decision', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const proposal = proposalFor(attemptId, STANDARD, config, clock.now);
    const first = await service.propose(proposal);
    const second = await service.propose(proposal);
    expect(second.decision).toEqual(first.decision);
    expect(second.toCoSign).toBe(first.toCoSign);
    expect(service.attempt(attemptId)?.attemptNumber).toBe(1);
  });

  it('refuses an attempt id that was used for a different proposal', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const other = { ...proposalFor(attemptId, STANDARD, config, clock.now), amountMinor: 999 };
    const reply = await service.propose(other);
    expect(reply.decision.decision).toBe('REFUSE');
    expect(reply.decision.reasons[0]?.code).toBe('INVARIANT_FAILED');
  });
});

describe('B2 identity, reservation and duplicates', () => {
  it('serializes different payables through one spending account until the prior transfer settles', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const second = entry({ invoiceNumber: 'INV-B2-002', fingerprint: sha256Hex('invoice-B2-002') });
    const service = await openService(base, config, evidenceFrom([STANDARD, second]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const firstId = newAttemptId();
    const first = await service.propose(proposalFor(firstId, STANDARD, config, clock.now));
    expect(first.decision.decision).toBe('ALLOW');

    const competing = await service.propose(proposalFor(newAttemptId(), second, config, clock.now));
    expect(competing.decision.decision).toBe('HOLD');
    expect(competing.decision.reasons[0]?.code).toBe('ACCOUNT_BUSY');
    expect(competing.toCoSign).toBeNull();

    const settled = await service.coSign(
      firstId,
      coSignAsAgent(base.agentWallet, first.toCoSign ?? ''),
    );
    expect(settled.outcome).toBe('paid');
    const afterSettlement = await service.propose(
      proposalFor(newAttemptId(), second, config, clock.now),
    );
    expect(afterSettlement.decision.decision).toBe('ALLOW');
  });

  it('lets exactly one of several concurrent proposals for the same payable proceed', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now)),
      ),
    );
    const allowed = replies.filter((reply) => reply.decision.decision === 'ALLOW');
    const held = replies.filter((reply) => reply.decision.decision === 'HOLD');
    expect(allowed).toHaveLength(1);
    expect(held).toHaveLength(4);
    expect(held.every((reply) => reply.decision.reasons[0]?.code === 'DUPLICATE')).toBe(true);
  });

  it('holds a new proposal for a payable that is already paid', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const first = await pay(service, base, config, STANDARD, clock);
    expect(first.outcome?.outcome).toBe('paid');
    const again = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(again.decision.decision).toBe('HOLD');
    expect(again.decision.reasons[0]?.code).toBe('DUPLICATE');
  });

  it('does not let an attempt that lapsed without a co-signature hold its payable', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const lapsed = newAttemptId();
    await service.propose(proposalFor(lapsed, STANDARD, config, clock.now));
    for (let step = 0; step < 30; step += 1) {
      base.ledger.advance();
    }
    const retry = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(retry.decision.decision).toBe('ALLOW');
    expect(service.attempt(lapsed)?.status).toBe('expired');
  });

  it('holds a proposal whose invoice is not in the evidence register', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('MISSING_EVIDENCE');
  });
});

describe('B3 verified supplier and destination', () => {
  it('holds a payment when the invoice prints an account other than the enrolled payee', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const changed = entry({
      invoiceNumber: 'INV-010',
      fingerprint: sha256Hex('invoice-010'),
      printedPayee: Wallet.generate().address,
    });
    const service = await openService(base, config, evidenceFrom([changed]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), changed, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('PAYEE_CHANGED');
  });

  it('holds a payment while a payout change is pending', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const { request, signature } = signedChange(
      supplier.privateKey,
      Wallet.generate().address,
      'nonce-pending-0001',
      clock.now,
    );
    await service.requestChange(SUPPLIER, request, signature);
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('PAYEE_CHANGED');
  });
});

describe('B4 three-way match', () => {
  it('holds a payable with no goods receipt', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const noReceipt = entry({
      invoiceNumber: 'INV-020',
      fingerprint: sha256Hex('invoice-020'),
      receivedMinor: null,
    });
    const service = await openService(base, config, evidenceFrom([noReceipt]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), noReceipt, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('MISSING_EVIDENCE');
  });

  it('holds an invoice outside the purchase-order tolerance', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const outside = entry({
      invoiceNumber: 'INV-021',
      fingerprint: sha256Hex('invoice-021'),
      order: { amountMinor: 2000, supplierId: SUPPLIER },
    });
    const service = await openService(base, config, evidenceFrom([outside]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), outside, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('AMOUNT_MISMATCH');
  });
});

describe('B5 limits', () => {
  it('a single operator cannot raise any limit: the raise waits and the current policy is kept', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([]), { clock });
    const lowered = await service.setLimits({ perPaymentMinor: 500 }, OPERATOR_A);
    expect(lowered.applied).toBe(true);
    const version = service.currentLimits().policyVersion;
    expect(service.currentLimits().perPaymentMinor).toBe(500);

    for (const patch of [
      { perPaymentMinor: 501 },
      { supplierDailyMinor: config.initialLimits.supplierDailyMinor + 1 },
      { dailyTotalMinor: config.initialLimits.dailyTotalMinor + 1 },
    ]) {
      const raised = await service.setLimits(patch, OPERATOR_A);
      expect(raised.applied).toBe(false);
      if (!raised.applied) {
        await expect(service.approveLimits(raised.requestId, OPERATOR_A)).rejects.toThrow(
          'cannot also approve',
        );
        // A lowering closes the waiting raise, so the next loop starts clean.
        await service.setLimits({ perPaymentMinor: 500 }, OPERATOR_A);
      }
      expect(service.currentLimits().perPaymentMinor).toBe(500);
    }
    expect(version).toBeDefined();
  });

  it('holds a payment over the per-payment limit', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      initialLimits: {
        perPaymentMinor: 500,
        supplierDailyMinor: 500_000,
        dailyTotalMinor: 1_000_000,
      },
    });
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('OVER_LIMIT');
  });

  it('applies a lowered limit to the next proposal', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const second = entry({ invoiceNumber: 'INV-030', fingerprint: sha256Hex('invoice-030') });
    const service = await openService(base, config, evidenceFrom([STANDARD, second]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const first = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(first.decision.decision).toBe('ALLOW');
    const outcome = await service.setLimits({ perPaymentMinor: 500 }, OPERATOR_A);
    if (!outcome.applied) {
      throw new Error('a lowered limit should apply at once');
    }
    const version = outcome.policyVersion;
    expect(version).not.toBe(config.policyVersion);
    const next = await service.propose({
      ...proposalFor(newAttemptId(), second, config, clock.now),
      policyVersion: version,
    });
    expect(next.decision.decision).toBe('HOLD');
    expect(next.decision.reasons[0]?.code).toBe('OVER_LIMIT');
  });

  it('holds a payment that would exceed the daily total', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      initialLimits: {
        perPaymentMinor: 100_000,
        supplierDailyMinor: 500_000,
        dailyTotalMinor: 1500,
      },
    });
    const clock = newClock();
    const second = entry({ invoiceNumber: 'INV-031', fingerprint: sha256Hex('invoice-031') });
    const service = await openService(base, config, evidenceFrom([STANDARD, second]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const first = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(first.decision.decision).toBe('ALLOW');
    const next = await service.propose(proposalFor(newAttemptId(), second, config, clock.now));
    expect(next.decision.reasons[0]?.code).toBe('OVER_LIMIT');
  });
});

describe('B6 transaction-type guard', () => {
  it('refuses an asset that the Warden has no configured ledger asset for', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const zar = entry({
      invoiceNumber: 'INV-040',
      fingerprint: sha256Hex('invoice-040'),
      currency: 'ZAR',
    });
    const service = await openService(base, config, evidenceFrom([zar]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), zar, config, clock.now));
    expect(reply.decision.decision).toBe('REFUSE');
    expect(reply.decision.reasons[0]?.code).toBe('UNSUPPORTED_TRANSACTION');
  });

  it('refuses a configured alternate asset until two distinct operators approve the proposal', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      alternateAssets: [
        { currency: 'EUR', ledgerCurrency: TEST_TOKEN_CURRENCY, issuer: base.issuer.address },
      ],
    });
    const clock = newClock();
    const eur = entry({
      invoiceNumber: 'INV-041',
      fingerprint: sha256Hex('invoice-041'),
      currency: 'EUR',
    });
    const service = await openService(base, config, evidenceFrom([eur]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const fresh = () => proposalFor(newAttemptId(), eur, config, clock.now);
    expect((await service.propose(fresh())).decision.reasons[0]?.code).toBe(
      'UNSUPPORTED_TRANSACTION',
    );
    await service.approveProposal(fresh(), OPERATOR_A);
    expect((await service.propose(fresh())).decision.decision).toBe('REFUSE');
    await service.approveProposal(fresh(), OPERATOR_A);
    expect((await service.propose(fresh())).decision.decision).toBe('REFUSE');
    await service.approveProposal(fresh(), OPERATOR_B);
    expect((await service.propose(fresh())).decision.decision).toBe('ALLOW');
  });
});

describe('B7 pause', () => {
  it('holds every proposal while paused, and proposes again after resume', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    await service.setPaused(true, OPERATOR_A);
    const paused = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(paused.decision.reasons[0]?.code).toBe('PAUSED');
    await service.setPaused(false, OPERATOR_A);
    const resumed = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(resumed.decision.decision).toBe('ALLOW');
  });
});

describe('B8 pre-signing ledger read', () => {
  it('holds a payment when the issuer has frozen the spending account trust line, and releases it when unfrozen', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    base.ledger.setLineFrozen(
      base.spending.address,
      TEST_TOKEN_CURRENCY,
      base.issuer.address,
      true,
    );
    const frozen = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(frozen.decision.decision).toBe('HOLD');
    expect(frozen.decision.reasons[0]?.code).toBe('ACCOUNT_FROZEN');
    base.ledger.setLineFrozen(
      base.spending.address,
      TEST_TOKEN_CURRENCY,
      base.issuer.address,
      false,
    );
    const released = await service.propose(
      proposalFor(newAttemptId(), STANDARD, config, clock.now),
    );
    expect(released.decision.decision).toBe('ALLOW');
  });

  it('holds a payment whose amount is above the spendable balance', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      initialLimits: {
        perPaymentMinor: 10_000_000,
        supplierDailyMinor: 50_000_000,
        dailyTotalMinor: 50_000_000,
      },
    });
    const clock = newClock();
    const big = entry({
      invoiceNumber: 'INV-050',
      fingerprint: sha256Hex('invoice-050'),
      amountMinor: 1_000_000,
      order: { amountMinor: 1_000_000, supplierId: SUPPLIER },
      receivedMinor: 1_000_000,
    });
    const service = await openService(base, config, evidenceFrom([big]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), big, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('INVARIANT_FAILED');
  });

  it('holds (fails closed) when the ledger cannot be read before signing', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const broken = {
      ...base.port,
      account: () => Promise.reject(new Error('ledger is down')),
    };
    const service = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      port: broken,
    });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('LEDGER_UNREADABLE');
    expect(reply.toCoSign).toBeNull();
  });

  it('holds, and never signs, when the spending account no longer has the approved signer configuration', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const altered = {
      ...base.port,
      account: async (address: string) => {
        const snapshot = await base.port.account(address);
        if (snapshot === null || address !== base.spending.address) {
          return snapshot;
        }
        return { ...snapshot, flags: snapshot.flags & ~LSF_DISABLE_MASTER };
      },
    };
    const service = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      port: altered,
    });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('SIGNER_CHANGE_NOT_APPROVED');
    expect(reply.toCoSign).toBeNull();
  });
});

describe('B9 supplier enrolment and payout changes', () => {
  it('refuses enrolment when the identity check does not verify the payee', async () => {
    const base = await provisionedBase();
    const config = configFor(base, { verifiedPayees: [] });
    const service = await openService(base, config, evidenceFrom([]), { clock: newClock() });
    await expect(
      service.enrolSupplier(
        {
          supplierId: SUPPLIER,
          payee: { address: base.supplierAccount.address, destinationTag: null },
          publicKey: spkiOf(generateKeyPairSync('ed25519').publicKey),
        },
        OPERATOR_A,
      ),
    ).rejects.toThrow('identity');
  });

  it('refuses approval of a supplier by the person who enrolled it', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    await service.enrolSupplier(
      {
        supplierId: SUPPLIER,
        payee: { address: base.supplierAccount.address, destinationTag: null },
        publicKey: generateSupplierKey().publicKey,
      },
      OPERATOR_A,
    );
    await expect(service.approveSupplier(SUPPLIER, OPERATOR_A)).rejects.toThrow(
      'cannot also approve',
    );
  });

  it('applies a payout change only after two people approve it and the cooling-off period ends', async () => {
    const base = await provisionedBase();
    const newAddress = await fundedPayee(base);
    const config = configFor(base, { verifiedPayees: [base.supplierAccount.address, newAddress] });
    const clock = newClock();
    const second = entry({ invoiceNumber: 'INV-060', fingerprint: sha256Hex('invoice-060') });
    const service = await openService(base, config, evidenceFrom([STANDARD, second]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const { request, signature } = signedChange(
      supplier.privateKey,
      newAddress,
      'nonce-change-0001',
      clock.now,
    );
    const changeId = await service.requestChange(SUPPLIER, request, signature);
    await service.confirmChange(SUPPLIER, changeId, OPERATOR_A);
    await service.approveChange(SUPPLIER, changeId, OPERATOR_B);
    const during = await service.propose(proposalFor(newAttemptId(), second, config, clock.now));
    expect(during.decision.reasons[0]?.code).toBe('PAYEE_CHANGED');
    clock.now = new Date(clock.now.getTime() + config.coolingOffMs + 1000);
    const after = await service.propose(proposalFor(newAttemptId(), second, config, clock.now));
    expect(after.decision.decision).toBe('ALLOW');
    const destination: Record<string, unknown> = decode(after.toCoSign ?? '');
    expect(destination['Destination']).toBe(newAddress);
    expect(service.supplierPayee(SUPPLIER)?.address).toBe(newAddress);
  });

  it("refuses a payout change signed with a key other than the supplier's current key", async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const stranger = generateKeyPairSync('ed25519').privateKey;
    const { request, signature } = signedChange(
      stranger,
      Wallet.generate().address,
      'nonce-unknown-0001',
      START,
    );
    await expect(service.requestChange(SUPPLIER, request, signature)).rejects.toThrow(
      'current key',
    );
  });

  it('refuses a payout change whose new key is not an Ed25519 key', async () => {
    const base = await provisionedBase();
    const service = await openService(base, configFor(base), evidenceFrom([]), {
      clock: newClock(),
    });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const request = {
      supplierId: SUPPLIER,
      newPayee: { address: base.supplierAccount.address, destinationTag: null },
      newPublicKey: Buffer.from('not-an-ed25519-key').toString('base64'),
      requestedAt: START.toISOString(),
      nonce: 'nonce-badkey-0001',
    };
    const signature = sign(
      null,
      Buffer.from(canonicalJson(request), 'utf8'),
      supplier.privateKey,
    ).toString('base64');
    await expect(service.requestChange(SUPPLIER, request, signature)).rejects.toThrow(
      'not a valid key',
    );
  });

  it("refuses a payee that is one of the Warden's own accounts, on enrolment and on a payout change", async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      verifiedPayees: [base.spending.address, base.supplierAccount.address],
    });
    const service = await openService(base, config, evidenceFrom([]), { clock: newClock() });
    await expect(
      service.enrolSupplier(
        {
          supplierId: SUPPLIER,
          payee: { address: base.spending.address, destinationTag: null },
          publicKey: generateSupplierKey().publicKey,
        },
        OPERATOR_A,
      ),
    ).rejects.toThrow("the Warden's own accounts");
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const { request, signature } = signedChange(
      supplier.privateKey,
      base.spending.address,
      'nonce-ownacct-0001',
      START,
    );
    await expect(service.requestChange(SUPPLIER, request, signature)).rejects.toThrow(
      "the Warden's own accounts",
    );
  });

  it('refuses a replayed payout change', async () => {
    const base = await provisionedBase();
    const newAddress = await fundedPayee(base);
    const config = configFor(base, { verifiedPayees: [base.supplierAccount.address, newAddress] });
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const { request, signature } = signedChange(
      supplier.privateKey,
      newAddress,
      'nonce-replay-0001',
      clock.now,
    );
    const changeId = await service.requestChange(SUPPLIER, request, signature);
    await service.confirmChange(SUPPLIER, changeId, OPERATOR_A);
    await service.approveChange(SUPPLIER, changeId, OPERATOR_B);
    await expect(service.requestChange(SUPPLIER, request, signature)).rejects.toThrow(WardenError);
  });

  it('refuses confirmation and approval by the same person, and approval before confirmation', async () => {
    const base = await provisionedBase();
    const config = configFor(base, {
      verifiedPayees: [base.supplierAccount.address, Wallet.generate().address],
    });
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base, supplier.publicKey);
    const { request, signature } = signedChange(
      supplier.privateKey,
      Wallet.generate().address,
      'nonce-order-0001',
      clock.now,
    );
    const changeId = await service.requestChange(SUPPLIER, request, signature);
    await expect(service.approveChange(SUPPLIER, changeId, OPERATOR_B)).rejects.toThrow(
      WardenError,
    );
    await service.confirmChange(SUPPLIER, changeId, OPERATOR_A);
    await expect(service.approveChange(SUPPLIER, changeId, OPERATOR_A)).rejects.toThrow(
      'cannot also approve',
    );
  });
});

describe('the event log and recovery', () => {
  it('finishes a submission a previous run left open, after a restart', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const log = memoryEventLog();
    const first = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
    const supplier = generateSupplierKey();
    await activeSupplier(first, base, supplier.publicKey);
    const attemptId = newAttemptId();
    const reply = await first.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    // Simulate a crash AFTER the Warden's last authorization, when both valid signatures
    // exist in its private submit journal, but BEFORE the caller receives settlement.
    const agentBlob = coSignAsAgent(base.agentWallet, reply.toCoSign ?? '');
    const unsigned = decode(reply.toCoSign ?? '') as unknown as SubmittableTransaction;
    const wardenBlob = signAsSigner(base.wardenWallet, unsigned);
    const finalBlob = combineSigned([agentBlob, wardenBlob]);
    await log.append({
      type: 'attempt.submitting',
      at: clock.now.toISOString(),
      attemptId,
      finalBlob,
      hash: hashOfSigned(finalBlob),
    });
    expect(first.attempt(attemptId)?.status).toBe('awaiting');
    await base.port.submit(finalBlob);
    const restarted = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
    await restarted.recover();
    expect(restarted.attempt(attemptId)?.status).toBe('paid');
    expect(balanceOf(base, base.supplierAccount.address)).toBe('10');
  });

  it('expires an attempt left awaiting past its ledger expiry when the Warden restarts', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const log = memoryEventLog();
    const first = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
    await activeSupplier(first, base, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    await first.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    for (let step = 0; step < 30; step += 1) {
      base.ledger.advance();
    }
    const restarted = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
    await restarted.recover();
    expect(restarted.attempt(attemptId)?.status).toBe('expired');
  });

  it('restores the pause, the limits and the policy version from the event log after a restart', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const log = memoryEventLog();
    const first = await openService(base, config, evidenceFrom([]), { clock, log });
    await first.setPaused(true, OPERATOR_A);
    const outcome = await first.setLimits({ perPaymentMinor: 500 }, OPERATOR_B);
    if (!outcome.applied) {
      throw new Error('a lowered limit should apply at once');
    }
    const version = outcome.policyVersion;
    const restarted = await openService(base, config, evidenceFrom([]), { clock, log });
    expect(restarted.health()).toEqual({ paused: true, policyVersion: version });
    expect(restarted.currentLimits().perPaymentMinor).toBe(500);
  });
});
