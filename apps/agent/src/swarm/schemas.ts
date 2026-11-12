import { z } from 'zod';

/**
 * The strict reply shapes of the two reviewers. A reply with any unknown key is invalid (z.strictObject), so a model
 * cannot add a field the code does not read, such as a confidence score or a memory write. Confidence is not a field.
 */

export const REVIEWER_ROLES = ['procurement', 'fraud'] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

export const VERDICTS = ['PASS', 'HOLD', 'ABSTAIN'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const PROCUREMENT_REASONS = [
  'NONE',
  'PO_MISSING',
  'PO_MISMATCH',
  'AMOUNT_OVER_PO',
  'GRN_MISSING',
  'QUANTITY_NOT_RECEIVED',
  'CURRENCY_MISMATCH',
  'INSUFFICIENT_CONTEXT',
] as const;

export const FRAUD_REASONS = [
  'NONE',
  'PAYEE_MISMATCH',
  'BANK_CHANGE_UNVERIFIED',
  'SENDER_DOMAIN_MISMATCH',
  'PRIOR_HOLD',
  'PATTERN_OUT_OF_RANGE',
  'INSUFFICIENT_CONTEXT',
] as const;

/** Which context item each quoted source must come from. The quote is checked against that item only. */
export const SOURCE_ITEM: Readonly<Record<string, string>> = {
  PO: 'po',
  GRN: 'grn',
  INVOICE: 'verified',
  SUPPLIER_RECORD: 'supplier',
  PAYEE: 'payee',
  SENDER: 'sender',
  HISTORY: 'history',
};

const Evidence = z.strictObject({
  source: z.enum(Object.keys(SOURCE_ITEM) as [string, ...string[]]),
  quote: z.string().min(1).max(300),
});

export const ProcurementReply = z.strictObject({
  schemaVersion: z.literal(1),
  verdict: z.enum(VERDICTS),
  reasonCode: z.enum(PROCUREMENT_REASONS),
  evidence: z.array(Evidence).min(1).max(3),
});

export const FraudReply = z.strictObject({
  schemaVersion: z.literal(1),
  verdict: z.enum(VERDICTS),
  reasonCode: z.enum(FRAUD_REASONS),
  evidence: z.array(Evidence).min(1).max(3),
});

export type ReviewReply = z.infer<typeof ProcurementReply> | z.infer<typeof FraudReply>;

export const REVIEW_SCHEMAS: Readonly<
  Record<ReviewerRole, typeof ProcurementReply | typeof FraudReply>
> = {
  procurement: ProcurementReply,
  fraud: FraudReply,
};

/** The JSON Schema sent with a call. Generated from the Zod schema, so the two cannot drift apart. */
export function replySchemaOf(role: ReviewerRole): {
  readonly name: string;
  readonly schema: Record<string, unknown>;
} {
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  const schema = z.toJSONSchema(REVIEW_SCHEMAS[role]) as Record<string, unknown>;
  Reflect.deleteProperty(schema, '$schema');
  return { name: `${role}_review`, schema };
}

export interface EvidenceItem {
  readonly source: string;
  readonly quote: string;
}
