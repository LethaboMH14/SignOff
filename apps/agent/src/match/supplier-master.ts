import { z } from 'zod';

import { SchemaVersion, SupplierId } from '../../../../packages/shared/src/schemas/primitives.js';

/**
 * The buyer's supplier master, as the agent sees it: who is enrolled, whether the enrolment is approved, and the
 * account printed for them on file. The agent compares an invoice's printed account with the enrolled one. The
 * Warden separately pays only the destination in its own verified record, so neither check depends on the other.
 */

export const SupplierMaster = z.strictObject({
  supplierId: SupplierId,
  legalName: z.string().min(1).max(200),
  enrolledPayeeAsPrinted: z.string().min(1).max(80).nullable(),
  status: z.enum(['approved', 'pending', 'suspended']),
});
export type SupplierMaster = z.infer<typeof SupplierMaster>;

export const SupplierMasterFile = z.strictObject({
  schemaVersion: SchemaVersion,
  suppliers: z.array(SupplierMaster).max(10_000),
});

/** Parses the file and refuses a supplier identifier that appears twice, since that makes the master ambiguous. */
export function parseSupplierMaster(json: unknown): readonly SupplierMaster[] {
  const file = SupplierMasterFile.parse(json);
  const seen = new Set<string>();
  for (const supplier of file.suppliers) {
    if (seen.has(supplier.supplierId)) {
      throw new Error('the supplier master repeats a supplier identifier');
    }
    seen.add(supplier.supplierId);
  }
  return file.suppliers;
}
