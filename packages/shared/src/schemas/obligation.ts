import { z } from 'zod';

import {
  CurrencyCode,
  MinorUnits,
  PayableMinorUnits,
  SchemaVersion,
  Sha256Hex,
  SupplierId,
} from './primitives.js';

/**
 * A payable with its money tracked against it. The obligation is one record for one invoice, and
 * its amounts change over time: partial payments, reservations and settlements update the numbers
 * and never create a second obligation. The invariants below cannot be violated by a stored record.
 */
export const Obligation = z
  .strictObject({
    schemaVersion: SchemaVersion,
    obligationKey: Sha256Hex,
    supplierId: SupplierId,
    currency: CurrencyCode,
    approvedMinor: PayableMinorUnits,
    reservedMinor: MinorUnits,
    settledMinor: MinorUnits,
    status: z.enum(['OPEN', 'SETTLED', 'CANCELLED']),
    /** Increases on every write. Used for optimistic concurrency. */
    version: z.int().min(0),
  })
  .superRefine((value, context) => {
    if (value.reservedMinor + value.settledMinor > value.approvedMinor) {
      context.addIssue({
        code: 'custom',
        message: 'reserved plus settled cannot exceed approved',
        path: ['reservedMinor'],
      });
    }
    if (
      value.status === 'SETTLED' &&
      (value.settledMinor !== value.approvedMinor || value.reservedMinor !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'a settled obligation must be fully settled with nothing reserved',
        path: ['status'],
      });
    }
    if (value.status === 'CANCELLED' && value.reservedMinor !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'a cancelled obligation cannot hold a reservation',
        path: ['status'],
      });
    }
  });

export type Obligation = z.infer<typeof Obligation>;

/** What is still available to reserve against this obligation, in minor units. */
export function remainingMinor(obligation: Obligation): number {
  return obligation.approvedMinor - obligation.reservedMinor - obligation.settledMinor;
}
