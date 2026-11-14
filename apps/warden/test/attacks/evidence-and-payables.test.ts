/*
 * Attack cases on the payable: missing goods receipt, duplicate invoice, concurrent requests for one payable, and
 * an excess amount. Every title is "ATK-nn | case | expected outcome".
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../src/canonical.js';
import { generateSupplierKey } from '../../src/client.js';
import {
  configFor,
  entry,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  provisionedBase,
  proposalFor,
  STANDARD,
} from '../helpers/world.js';

import { activeSupplier, firstReason, payThrough } from './attack-world.js';

describe('attacks on the payable and its evidence', { timeout: 30_000 }, () => {
  it('ATK-04 | missing goods receipt | HOLD MISSING_EVIDENCE', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const item = entry({
      invoiceNumber: 'INV-201',
      fingerprint: sha256Hex('invoice-201'),
      receivedMinor: null,
    });
    const service = await openService(base, config, evidenceFrom([item]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const reply = await service.propose(proposalFor(newAttemptId(), item, config, clock.now));

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('MISSING_EVIDENCE');
    expect(reply.toCoSign).toBeNull();
  });

  it('ATK-05 | duplicate invoice, already paid | HOLD DUPLICATE', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const paidId = await payThrough(service, base, config, STANDARD, clock);
    expect(service.attempt(paidId)?.status).toBe('paid');

    // The same invoice, proposed again under a new attempt id: the payable is already settled.
    const again = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));

    expect(again.decision.decision).toBe('HOLD');
    expect(firstReason(again.decision)).toBe('DUPLICATE');
    expect(again.toCoSign).toBeNull();
  });

  it('ATK-06 | concurrent requests for the same payable | exactly one ALLOW, four HOLD DUPLICATE', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now)),
      ),
    );

    const allowed = replies.filter((reply) => reply.decision.decision === 'ALLOW');
    const held = replies.filter((reply) => reply.decision.decision === 'HOLD');
    expect(allowed).toHaveLength(1);
    expect(held).toHaveLength(4);
    expect(held.every((reply) => firstReason(reply.decision) === 'DUPLICATE')).toBe(true);
  });

  it('ATK-07 | excess amount: proposal above the invoice | HOLD AMOUNT_MISMATCH', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const reply = await service.propose({
      ...proposalFor(newAttemptId(), STANDARD, config, clock.now),
      amountMinor: STANDARD.amountMinor + 500,
    });

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('AMOUNT_MISMATCH');
    expect(reply.toCoSign).toBeNull();
  });

  it('ATK-07 | excess amount: invoice above the per-payment limit | HOLD OVER_LIMIT', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const big = entry({
      invoiceNumber: 'INV-202',
      fingerprint: sha256Hex('invoice-202'),
      amountMinor: 200_000,
      order: { amountMinor: 200_000, supplierId: 'SUP-ABCD1234' },
      receivedMinor: 200_000,
    });
    const service = await openService(base, config, evidenceFrom([big]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const reply = await service.propose(proposalFor(newAttemptId(), big, config, clock.now));

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('OVER_LIMIT');
    expect(reply.toCoSign).toBeNull();
  });
});
