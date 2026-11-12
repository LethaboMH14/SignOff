/**
 * Context engineering types. Every item the model sees carries a trust label and a provenance. A role sees only the
 * item kinds its job needs (see policy in build.ts), and the budget is per role, so a long invoice cannot push a
 * reviewer's policy text out of its window.
 */

export const ROLES = ['extractor', 'procurement', 'fraud'] as const;
export type Role = (typeof ROLES)[number];

/** invoice: untrusted supplier text. buyer-record: the buyer's own PO, GRN, supplier and history records. verified: values code has checked. policy: the operator's rules. */
export const TRUST_LABELS = ['invoice', 'buyer-record', 'verified', 'policy'] as const;
export type TrustLabel = (typeof TRUST_LABELS)[number];

export interface ContextItem {
  /** A stable id such as "po" or "verified.total". Items are emitted in id order, so the context is deterministic. */
  readonly id: string;
  readonly trust: TrustLabel;
  /** Where the text came from, for the audit trail. For example "PO record PO-TST-0101" or "invoice page 1". */
  readonly provenance: string;
  /** Account numbers are already masked here, and no keys are present (see mask.ts). */
  readonly text: string;
  /** An estimate of tokens: ceil(characters / 4). Not a provider count, and labelled as an estimate in the reports. */
  readonly tokens: number;
}

export interface RoleContext {
  readonly role: Role;
  readonly items: readonly ContextItem[];
  readonly tokenBudget: number;
  readonly tokensUsed: number;
  readonly policyVersion: string;
}

/** One record the caller supplies. The builder decides by kind which roles may see it. */
export type RecordKind =
  | 'INVOICE_TEXT'
  | 'VERIFIED_FIELD'
  | 'PO'
  | 'GRN'
  | 'SUPPLIER_RECORD'
  | 'SUPPLIER_HISTORY'
  | 'PAYEE_EVIDENCE'
  | 'SENDER_CHECK'
  | 'POLICY';

export interface SourceRecord {
  readonly id: string;
  readonly kind: RecordKind;
  readonly provenance: string;
  readonly text: string;
}
