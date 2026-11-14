import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import {
  evidenceRegister,
  type EvidenceRegister,
} from '../../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../../packages/shared/src/schemas/evidence.js';
import {
  CurrencyCode,
  IsoDate,
  MinorUnits,
  SupplierId,
} from '../../../../packages/shared/src/schemas/primitives.js';
import { parseSupplierMaster, type SupplierMaster } from '../match/supplier-master.js';

/**
 * The labelled set as the evaluation reads it. The loader checks every file against its schema, so a damaged label
 * or a missing record stops the run before any number is produced.
 */

export const CATEGORIES = [
  'clean',
  'messy',
  'injected',
  'missing',
  'forged-payee',
  'over-limit',
  'duplicate',
] as const;
export type Category = (typeof CATEGORIES)[number];

const Text = z.string().min(1).max(200);
/** The exact line of the PDF text that states a field. Null when the field is not stated. */
const Span = z.string().min(1).max(200).nullable();

export const LabelledCase = z.strictObject({
  id: z.string().regex(/^[a-z-]+-\d{2}$/),
  category: z.enum(CATEGORIES),
  file: z.string().regex(/^invoices\/[a-z0-9-]+\.pdf$/),
  supplierId: SupplierId,
  expected: z.strictObject({
    decision: z.enum(['ELIGIBLE', 'HOLD']),
    reason: z
      .string()
      .regex(/^[A-Z_]+$/)
      .nullable(),
    fields: z.strictObject({
      supplierName: Text.nullable(),
      invoiceNumber: Text.nullable(),
      invoiceDate: IsoDate.nullable(),
      currency: CurrencyCode.nullable(),
      totalMinor: MinorUnits.nullable(),
      purchaseOrderNumber: Text.nullable(),
      payeeAccountAsPrinted: Text.nullable(),
    }),
    spans: z.strictObject({
      supplierName: Span,
      invoiceNumber: Span,
      invoiceDate: Span,
      currency: Span,
      totalMinor: Span,
      purchaseOrderNumber: Span,
      payeeAccountAsPrinted: Span,
    }),
  }),
  note: z.string().max(300),
});
export type LabelledCase = z.infer<typeof LabelledCase>;

const LabelsFile = z.strictObject({
  notice: z.string().min(1).max(300),
  cases: z.array(LabelledCase).min(1).max(1000),
});

export interface LabelledSet {
  readonly dir: string;
  readonly notice: string;
  readonly cases: readonly LabelledCase[];
  readonly evidence: EvidenceRegister;
  readonly suppliers: readonly SupplierMaster[];
}

function readJson(path: string): unknown {
  // The path is inside the labelled-set folder named on the command line.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function loadLabelledSet(dir: string): LabelledSet {
  const labels = LabelsFile.parse(readJson(join(dir, 'labels.json')));
  const evidenceFile = EvidenceFile.parse(readJson(join(dir, 'evidence.json')));
  const suppliers = parseSupplierMaster(readJson(join(dir, 'suppliers.json')));
  const ids = new Set<string>();
  for (const item of labels.cases) {
    if (ids.has(item.id)) {
      throw new Error('the labelled set repeats a case identifier');
    }
    ids.add(item.id);
  }
  return {
    dir,
    notice: labels.notice,
    cases: labels.cases,
    evidence: evidenceRegister(evidenceFile),
    suppliers,
  };
}
