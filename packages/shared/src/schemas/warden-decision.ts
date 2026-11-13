import { z } from 'zod';

import { IsoInstant, PolicyVersion, SchemaVersion, Sha256Hex } from './primitives.js';

/** Why Warden did not sign. Every refusal or hold names at least one of these. */
export const WardenReasonCode = z.enum([
  'PAYEE_NOT_VERIFIED',
  'PAYEE_CHANGED',
  'SUPPLIER_NOT_APPROVED',
  'SUPPLIER_CREDENTIAL_MISSING',
  'MISSING_EVIDENCE',
  'AMOUNT_MISMATCH',
  'DUPLICATE',
  'OVER_LIMIT',
  'PAUSED',
  'LEDGER_UNREADABLE',
  'ACCOUNT_FROZEN',
  'UNSUPPORTED_TRANSACTION',
  'SIGNER_CHANGE_NOT_APPROVED',
  'INVARIANT_FAILED',
  'ACCOUNT_BUSY',
  'RECEIVING_CAPACITY',
  'OWNER_APPROVAL_UNAVAILABLE',
]);

export type WardenReasonCode = z.infer<typeof WardenReasonCode>;

export const WardenReason = z.strictObject({
  code: WardenReasonCode,
  message: z.string().min(1).max(300),
});

const DecisionCommon = {
  schemaVersion: SchemaVersion,
  proposalFingerprint: Sha256Hex,
  policyVersion: PolicyVersion,
  evaluatedAt: IsoInstant,
};

/**
 * Warden's answer. ALLOW carries no reasons. HOLD and REFUSE must carry at least one reason:
 * HOLD waits for evidence or a person, and REFUSE never retries on its own. A decision that does
 * not match its reasons cannot be built.
 */
export const WardenDecision = z.discriminatedUnion('decision', [
  z.strictObject({
    ...DecisionCommon,
    decision: z.literal('ALLOW'),
    reasons: z.array(WardenReason).length(0),
    /** True when the Warden will not co-sign until the owner signs too (a high-value payment). Optional, so older answers still parse. */
    ownerApprovalRequired: z.boolean().optional(),
  }),
  z.strictObject({
    ...DecisionCommon,
    decision: z.literal('HOLD'),
    reasons: z.array(WardenReason).min(1),
  }),
  z.strictObject({
    ...DecisionCommon,
    decision: z.literal('REFUSE'),
    reasons: z.array(WardenReason).min(1),
  }),
]);

export type WardenDecision = z.infer<typeof WardenDecision>;
