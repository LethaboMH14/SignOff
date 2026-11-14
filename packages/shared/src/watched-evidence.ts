/* eslint-disable security/detect-non-literal-fs-filename -- the path is the operator's evidence export, named at start-up */
import { readFileSync, statSync } from 'node:fs';

import { evidenceRegister, type EvidenceRegister } from './evidence-register.js';
import { EvidenceFile } from './schemas/evidence.js';

/**
 * An evidence register that follows its file. Each lookup checks the file's modification time and re-reads it when it
 * changed, so records written after start-up (a new invoice, its order and its goods receipt) are found without a
 * restart. The file must be valid at start-up. If a later version cannot be read or does not match the schema, the last
 * valid version stays in use: a record that is not in it is missing, so the invoice is held, never paid on a guess.
 */
export function watchedEvidenceRegister(path: string): EvidenceRegister {
  let current = evidenceRegister(
    EvidenceFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown),
  );
  let seen = statSync(path).mtimeMs;

  const fresh = (): EvidenceRegister => {
    try {
      const mtime = statSync(path).mtimeMs;
      if (mtime !== seen) {
        current = evidenceRegister(
          EvidenceFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown),
        );
        seen = mtime;
      }
    } catch {
      // Keep the last valid version. The next lookup tries again.
    }
    return current;
  };

  return {
    invoice: (fingerprint) => fresh().invoice(fingerprint),
    purchaseOrder: (purchaseOrderId) => fresh().purchaseOrder(purchaseOrderId),
    goodsReceipt: (purchaseOrderId) => fresh().goodsReceipt(purchaseOrderId),
  };
}
