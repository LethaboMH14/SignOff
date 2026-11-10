import { describe, expect, it } from 'vitest';

import { PaymentProposal } from '../../src/schemas/proposal.js';
import { validProposal } from '../helpers/fixtures.js';

describe('PaymentProposal schema', () => {
  it('accepts a proposal that names a verified supplier and an amount', () => {
    expect(PaymentProposal.safeParse(validProposal()).success).toBe(true);
  });

  it.each(['destination', 'payTo', 'account', 'bankAccount'])(
    'rejects a proposal that carries a payee field named %s',
    (field) => {
      const proposal = { ...validProposal(), [field]: 'rExampleAddress' };
      expect(PaymentProposal.safeParse(proposal).success).toBe(false);
    },
  );

  it.each([0, -1, 12.5, 1_000_000_000_000_001])(
    'rejects the amount %s, which is not a payable whole number of minor units',
    (amountMinor) => {
      expect(PaymentProposal.safeParse({ ...validProposal(), amountMinor }).success).toBe(false);
    },
  );

  it('rejects a proposal from anyone other than the agent', () => {
    expect(PaymentProposal.safeParse({ ...validProposal(), proposedBy: 'human' }).success).toBe(
      false,
    );
  });

  it('rejects malformed identifiers', () => {
    const cases = [
      { obligationKey: 'ABCDEF' },
      { attemptId: 'not-a-uuid' },
      { supplierId: 'supplier-lowercase' },
      { policyVersion: '2026/11/10' },
    ];
    for (const change of cases) {
      expect(PaymentProposal.safeParse({ ...validProposal(), ...change }).success).toBe(false);
    }
  });

  it('rejects a timestamp with a time-zone offset instead of UTC', () => {
    const proposal = { ...validProposal(), proposedAt: '2026-11-10T10:00:00+02:00' };
    expect(PaymentProposal.safeParse(proposal).success).toBe(false);
  });
});
