import { z } from 'zod';

import {
  AttemptId,
  CurrencyCode,
  IsoInstant,
  PayableMinorUnits,
  PolicyVersion,
  SchemaVersion,
  Sha256Hex,
  SupplierId,
} from './primitives.js';

/**
 * What the agent may propose. It names a verified supplier and an amount, and nothing else:
 * there is no destination field, because a destination is never taken from a document or from
 * the model. Unknown keys are rejected, so a proposal cannot carry a payee by accident.
 */
export const PaymentProposal = z.strictObject({
  schemaVersion: SchemaVersion,
  obligationKey: Sha256Hex,
  attemptId: AttemptId,
  supplierId: SupplierId,
  currency: CurrencyCode,
  amountMinor: PayableMinorUnits,
  invoiceFingerprint: Sha256Hex,
  policyVersion: PolicyVersion,
  proposedBy: z.literal('agent'),
  proposedAt: IsoInstant,
});

export type PaymentProposal = z.infer<typeof PaymentProposal>;
