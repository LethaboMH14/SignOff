import { readFileSync } from 'node:fs';

import {
  evidenceRegister,
  type EvidenceRegister,
} from '../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../packages/shared/src/schemas/evidence.js';

/**
 * The evidence the Warden checks a payment against. The schemas and the lookups are shared with the agent (see
 * packages/shared). This module keeps the Warden's loader, which reads the operator's export once at start-up.
 */

export {
  EvidenceFile,
  GoodsReceiptRecord,
  InvoiceRecord,
  PurchaseOrderRecord,
} from '../../../packages/shared/src/schemas/evidence.js';
export {
  evidenceRegister,
  type EvidenceRegister,
} from '../../../packages/shared/src/evidence-register.js';

/** Reads and validates the evidence file. Anything that does not match the schema stops the Warden. */
export function loadEvidence(path: string): EvidenceRegister {
  // The path is the operator's evidence export, read once at start-up.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return evidenceRegister(EvidenceFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown));
}
