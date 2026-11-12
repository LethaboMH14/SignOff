/*
 * Pins the #45 repair: the Warden returns unsigned terms, and finalize re-checks policy, ledger and payee before it
 * adds its own signature. Every title is "PIN-nn | case | expected outcome".
 */
import { decode, Wallet, type SubmittableTransaction } from 'xrpl';
import { describe, expect, it } from 'vitest';

import { coSignAsAgent, generateSupplierKey } from '../../src/client.js';
import { TEST_TOKEN_CURRENCY } from '../../../../packages/xrpl/src/constants.js';
import { signAsSigner, signerAccounts } from '../../../../packages/xrpl/src/index.js';
import {
  configFor,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  provisionedBase,
  proposalFor,
  STANDARD,
} from '../helpers/world.js';
import { activeSupplier, refusalOf, signedChange } from './attack-world.js';

describe('pinned final authorization (#45 repair)', { timeout: 30_000 }, () => {
  it('PIN-01 | proposal returns unsigned terms | ALLOW, toCoSign carries no Warden signature', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);

    const reply = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));

    expect(reply.decision.decision).toBe('ALLOW');
    const terms = decode(reply.toCoSign ?? '');
    expect(terms['Signers']).toBeUndefined();
    expect(terms['TxnSignature']).toBeFalsy();
    expect(signerAccounts(reply.toCoSign ?? '')).toEqual([]);
  });

  it('PIN-02 | policy changed between proposal and final authorization | REJECTED 409, nothing submitted', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    await service.setLimits({ supplierDailyMinor: 400_000 }, 'operator-a');
    const before = base.ledger.submitted.length;

    const refused = await refusalOf(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    );

    expect(refused.status).toBe(409);
    expect(refused.message).toContain('policy changed');
    expect(base.ledger.submitted.length).toBe(before);
  });

  it('PIN-03 | trust line frozen after proposal | REJECTED 409 at the Warden re-check, nothing submitted', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    base.ledger.setLineFrozen(
      base.spending.address,
      TEST_TOKEN_CURRENCY,
      base.issuer.address,
      true,
    );
    const before = base.ledger.submitted.length;

    const refused = await refusalOf(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    );

    expect(refused.status).toBe(409);
    expect(refused.message).toContain('ledger no longer permits');
    expect(base.ledger.submitted.length).toBe(before);
  });

  it('PIN-04 | agent alters the amount before co-signing | REJECTED 422, the Warden never signs the altered terms', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    await activeSupplier(service, base.supplierAccount.address, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const altered = { ...decode(reply.toCoSign ?? '') } as unknown as SubmittableTransaction & {
      Amount: unknown;
    };
    altered.Amount = { currency: TEST_TOKEN_CURRENCY, issuer: base.issuer.address, value: '1' };
    const forged = signAsSigner(base.agentWallet, altered);

    const refused = await refusalOf(service.coSign(attemptId, forged));

    expect(refused.status).toBe(422);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });

  it('PIN-05 | payout change requested after proposal | REJECTED 409 payee changing, propose again', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
    const supplier = generateSupplierKey();
    await activeSupplier(service, base.supplierAccount.address, supplier.publicKey);
    const attemptId = newAttemptId();
    const reply = await service.propose(proposalFor(attemptId, STANDARD, config, clock.now));
    const { request, signature } = signedChange(
      supplier.privateKey,
      Wallet.generate().address,
      'pin-after-proposal-nonce',
      clock.now,
    );
    await service.requestChange('SUP-ABCD1234', request, signature);

    const refused = await refusalOf(
      service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign ?? '')),
    );

    expect(refused.status).toBe(409);
    expect(service.attempt(attemptId)?.status).toBe('awaiting');
  });
});
