import { assertNoSecrets, maskAccounts } from './mask.js';
import type {
  ContextItem,
  RecordKind,
  Role,
  RoleContext,
  SourceRecord,
  TrustLabel,
} from './types.js';

/**
 * buildContext(role, records) returns the bounded context for one role. Each role has an allow-list of record kinds, so
 * a reviewer never receives a record its job does not need: the procurement reviewer sees the PO and GRN, and the fraud
 * reviewer sees the supplier history and payee evidence. A record of another kind is dropped, never passed on.
 *
 * The budget is per role, in estimated tokens. A context over budget is refused, not cut: a cut could remove the very
 * line a reviewer must quote, so the invoice is held instead.
 */

export const TOKEN_BUDGET: Readonly<Record<Role, number>> = {
  extractor: 3_000,
  procurement: 1_200,
  fraud: 1_500,
};

export const POLICY_VERSION = 'policy-v1';

const KIND_ALLOW: Readonly<Record<Role, readonly RecordKind[]>> = {
  extractor: ['INVOICE_TEXT'],
  procurement: ['VERIFIED_FIELD', 'PO', 'GRN', 'POLICY'],
  fraud: [
    'VERIFIED_FIELD',
    'SUPPLIER_RECORD',
    'SUPPLIER_HISTORY',
    'PAYEE_EVIDENCE',
    'SENDER_CHECK',
    'POLICY',
  ],
};

const TRUST_OF: Readonly<Record<RecordKind, TrustLabel>> = {
  INVOICE_TEXT: 'invoice',
  VERIFIED_FIELD: 'verified',
  SENDER_CHECK: 'verified',
  PO: 'buyer-record',
  GRN: 'buyer-record',
  SUPPLIER_RECORD: 'buyer-record',
  SUPPLIER_HISTORY: 'buyer-record',
  PAYEE_EVIDENCE: 'buyer-record',
  POLICY: 'policy',
};

export class ContextBudgetError extends Error {
  readonly role: Role;
  readonly tokensNeeded: number;
  readonly tokenBudget: number;

  constructor(role: Role, tokensNeeded: number, tokenBudget: number) {
    super(
      `the ${role} context needs ${String(tokensNeeded)} tokens, over its budget of ${String(tokenBudget)}`,
    );
    this.name = 'ContextBudgetError';
    this.role = role;
    this.tokensNeeded = tokensNeeded;
    this.tokenBudget = tokenBudget;
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The record kinds a role may see. */
export function kindsFor(role: Role): readonly RecordKind[] {
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  return KIND_ALLOW[role];
}

export function buildContext(
  role: Role,
  records: readonly SourceRecord[],
  policyVersion: string = POLICY_VERSION,
): RoleContext {
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  const allowed = new Set<RecordKind>(KIND_ALLOW[role]);
  const items: ContextItem[] = [];
  for (const record of [...records].sort(byId)) {
    if (!allowed.has(record.kind)) {
      continue;
    }
    assertNoSecrets(record.text);
    const text = maskAccounts(record.text);
    items.push({
      id: record.id,
      trust: TRUST_OF[record.kind],
      provenance: record.provenance,
      text,
      tokens: estimateTokens(text),
    });
  }
  const tokensUsed = items.reduce((total, item) => total + item.tokens, 0);
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  const tokenBudget = TOKEN_BUDGET[role];
  if (tokensUsed > tokenBudget) {
    throw new ContextBudgetError(role, tokensUsed, tokenBudget);
  }
  return { role, items, tokenBudget, tokensUsed, policyVersion };
}

function byId(a: SourceRecord, b: SourceRecord): number {
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}
