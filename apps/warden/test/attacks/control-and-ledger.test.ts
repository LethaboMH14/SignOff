/*
 * Attack cases on the controls and the ledger: a single compromised key, a ledger timeout, a lowered limit, a pause
 * while a proposal is in flight, a non-payment transaction, and a wrong RLUSD issuer.
 * Every title is "ATK-nn | case | expected outcome".
 */
import { Wallet, type SubmittableTransaction } from 'xrpl';
import { describe, expect, it } from 'vitest';

import { TEST_TOKEN_CURRENCY } from '../../../../packages/xrpl/src/constants.js';
import { signAsSigner } from '../../../../packages/xrpl/src/index.js';
import { sha256Hex } from '../../src/canonical.js';
import { coSignAsAgent, generateSupplierKey } from '../../src/client.js';
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

import {
  activeSupplier,
  firstReason,
  outagePort,
  payeeTrustingOnly,
  refusalOf,
  wardenOnlyBlob,
  type Outage,
} from './attack-world.js';

describe('attacks on the controls and the ledger', { timeout: 30_000 }, () => {
  it('ATK-08 | single compromised key: agent key alone broadcasts | ledger REJECTS tefBAD_QUORUM, nothing settles', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const before = base.ledger.submitted.length;

    const result = await base.port.submit(coSignAsAgent(base.agentWallet, reply.toCoSign ?? ''));

    expect(result.engineResult).toBe('tefBAD_QUORUM');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
    expect(base.ledger.submitted.length).toBe(before + 1);
  });

  it('ATK-08 | single compromised key: Warden key alone signs and broadcasts | ledger REJECTS tefBAD_QUORUM', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));

    const result = await base.port.submit(wardenOnlyBlob(base, reply.toCoSign ?? ''));

    expect(result.engineResult).toBe('tefBAD_QUORUM');
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('ATK-09 | ledger timeout before signing | HOLD LEDGER_UNREADABLE, nothing prepared', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const outage: Outage = { down: true };
    const service = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      port: outagePort(base, outage),
    });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('LEDGER_UNREADABLE');
    expect(reply.toCoSign).toBeNull();
  });

  it('ATK-09 | ledger timeout at final authorization | REJECTED 503, attempt stays awaiting, nothing submitted', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const outage: Outage = { down: false };
    const service = await openService(base, config, evidenceFrom([STANDARD]), {
      clock,
      port: outagePort(base, outage),
    });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const before = base.ledger.submitted.length;
    outage.down = true;

    const refused = await refusalOf(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    );

    expect(refused.status).toBe(503);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
    expect(base.ledger.submitted.length).toBe(before);
  });

  it('ATK-10 | lowered limit while a proposal is in flight | REJECTED 409 policy changed, nothing submitted', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    expect(reply.decision.decision).toBe('ALLOW');
    await service.setLimits({ perPaymentMinor: 500 }, 'operator-a');
    const before = base.ledger.submitted.length;

    const refused = await refusalOf(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    );

    expect(refused.status).toBe(409);
    expect(refused.message).toContain('policy changed');
    expect(base.ledger.submitted.length).toBe(before);
  });

  it('ATK-10 | lowered limit for the next proposal | HOLD OVER_LIMIT', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const next = entry({ invoiceNumber: 'INV-301', fingerprint: sha256Hex('invoice-301') });
    const service = await openService(base, config, evidenceFrom([STANDARD, next]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const outcome = await service.setLimits({ perPaymentMinor: 500 }, 'operator-a');
    if (!outcome.applied) throw new Error('a lowered limit must apply at once');
    const version = outcome.policyVersion;

    const reply = await service.propose({
      ...proposalFor(newAttemptId(), next, config, clock.now),
      policyVersion: version,
    });

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('OVER_LIMIT');
  });

  it('ATK-11 | pause while a proposal is in flight | REJECTED 409 paused, nothing submitted, pays after resume', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    await service.setPaused(true, 'operator-a');
    const before = base.ledger.submitted.length;

    const refused = await refusalOf(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    );

    expect(refused.status).toBe(409);
    expect(refused.message).toContain('paused');
    expect(base.ledger.submitted.length).toBe(before);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');

    await service.setPaused(false, 'operator-a');
    await service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? ''));
    expect(service.attempt(attemptId)?.status).toBe('paid');
  });

  it('ATK-11 | pause before a proposal | HOLD PAUSED, no terms prepared', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    await service.setPaused(true, 'operator-a');

    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('PAUSED');
    expect(reply.toCoSign).toBeNull();
  });

  it('ATK-12 | non-payment transaction type, signed by the agent | REJECTED 422, nothing submitted', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const accountSet = signAsSigner(base.agentWallet, {
      TransactionType: 'AccountSet',
      Account: base.spending.address,
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 99,
      SigningPubKey: '',
    } as unknown as SubmittableTransaction);
    const before = base.ledger.submitted.length;

    const refused = await refusalOf(service.coSign(attemptId, accountSet));

    expect(refused.status).toBe(422);
    expect(base.ledger.submitted.length).toBe(before);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('ATK-13 | wrong RLUSD issuer: payee holds the currency only from another issuer | HOLD INVARIANT_FAILED', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const rogue = Wallet.generate();
    base.ledger.fund(rogue);
    const payee = await payeeTrustingOnly(base, rogue.address);
    const service = await openService(
      base,
      { ...config, verifiedPayees: [payee] },
      evidenceFrom([STANDARD]),
      { clock },
    );
    await activeSupplier(service, payee, generateSupplierKey().publicKey);

    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));

    expect(reply.decision.decision).toBe('HOLD');
    expect(firstReason(reply.decision)).toBe('INVARIANT_FAILED');
    expect(reply.toCoSign).toBeNull();
  });

  it('ATK-13 | wrong RLUSD issuer: an alternate asset from an unapproved issuer | REFUSE UNSUPPORTED_TRANSACTION', async () => {
    const base = await provisionedBase();
    const rogue = Wallet.generate();
    const config = configFor(base, {
      alternateAssets: [
        { currency: 'EUR', ledgerCurrency: TEST_TOKEN_CURRENCY, issuer: rogue.address },
      ],
    });
    const clock = newClock();
    const eur = entry({
      invoiceNumber: 'INV-401',
      fingerprint: sha256Hex('invoice-401'),
      currency: 'EUR',
    });
    const service = await openService(base, config, evidenceFrom([eur]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const reply = await service.propose(proposalFor(newAttemptId(), eur, config, clock.now));

    expect(reply.decision.decision).toBe('REFUSE');
    expect(firstReason(reply.decision)).toBe('UNSUPPORTED_TRANSACTION');
    expect(reply.toCoSign).toBeNull();
  });
});
