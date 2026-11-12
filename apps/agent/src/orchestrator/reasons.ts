import { z } from 'zod';

import type { ModelClient } from '../model/types.js';
import { newDelimiterId, loadPrompt } from '../prompts/registry.js';
import type { SwarmBudget } from '../swarm/budget.js';

/**
 * The plain-English reason for a hold. Code decides the reason code. The sentence comes from a fixed template by default.
 * A model may draft a sentence only when a repair slot is unused, and the draft is kept only if it passes the checks in
 * draftReason: the reason code it echoes must match, it must not claim approval, and it must be short. Otherwise the
 * template is used. The draft never changes the decision.
 */

const TEMPLATES: Readonly<Record<string, string>> = {
  SENDER_CHECK_NOT_PASSED:
    'The sender check did not pass, so the invoice is held until a person confirms the sender.',
  EXTRACTION_FAILED:
    'The invoice could not be read reliably, so it is held for a person to check the document.',
  JUDGE_CALL_FAILED:
    'A review call did not complete, so the invoice is held rather than guessed at.',
  JUDGE_SCHEMA_INVALID:
    'A reviewer reply did not match the required format, so the invoice is held.',
  JUDGE_QUOTE_UNVERIFIED:
    'A reviewer quote could not be found in the source, so the invoice is held.',
  JUDGE_INCONSISTENT_REPLY:
    'A reviewer verdict and its reason did not agree, so the invoice is held.',
  JUDGE_REVIEWERS_DISAGREE:
    'The procurement reviewer passed the invoice, but the amount check in code did not, so it is held.',
  JUDGE_LATENCY_EXCEEDED: 'The review took longer than the allowed time, so the invoice is held.',
  JUDGE_CODE_CHECK_MISSING:
    'The purchase order amount could not be checked by code, so the invoice is held.',
  JUDGE_MISSING_REVIEW: 'A required review did not run, so the invoice is held.',
  JUDGE_UNRESOLVED: 'The reviews did not reach a clear result, so the invoice is held.',
  PROCUREMENT_PO_MISSING: 'No purchase order matches this invoice, so it is held.',
  PROCUREMENT_PO_MISMATCH:
    'The purchase order on the invoice does not match the purchase order record.',
  PROCUREMENT_AMOUNT_OVER_PO: 'The invoice total is above the purchase order value.',
  PROCUREMENT_GRN_MISSING: 'No goods receipt is recorded for this invoice, so it is held.',
  PROCUREMENT_QUANTITY_NOT_RECEIVED: 'Some invoiced quantities are not on the goods receipt.',
  PROCUREMENT_CURRENCY_MISMATCH: 'The invoice currency does not match the purchase order.',
  PROCUREMENT_INSUFFICIENT_CONTEXT:
    'The procurement reviewer could not decide from the records available.',
  FRAUD_PAYEE_MISMATCH: 'The payee account on the invoice differs from the enrolled account.',
  FRAUD_BANK_CHANGE_UNVERIFIED:
    'The supplier bank account changed and has not been confirmed by a call-back.',
  FRAUD_SENDER_DOMAIN_MISMATCH: 'The sender domain differs from the enrolled domain.',
  FRAUD_PRIOR_HOLD: 'This supplier has a prior hold that a person has not cleared.',
  FRAUD_PATTERN_OUT_OF_RANGE: "The invoice differs from this supplier's usual pattern.",
  FRAUD_INSUFFICIENT_CONTEXT: 'The fraud reviewer could not decide from the records available.',
};

export function templateFor(code: string): string {
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  return TEMPLATES[code] ?? `The invoice is held for a person to review (reason ${code}).`;
}

const DraftReply = z.strictObject({
  schemaVersion: z.literal(1),
  text: z.string().min(1).max(240),
  reasonCode: z.string().min(1).max(64),
});

const APPROVAL_WORDS = /\b(approved|approve|approves|paid|pay now|safe to pay|release|released)\b/i;

export interface ReasonResult {
  readonly text: string;
  readonly source: 'template' | 'model';
}

export interface DraftInput {
  readonly code: string;
  readonly client: ModelClient;
  readonly budget: SwarmBudget;
  readonly nonce?: () => string;
}

/** Drafts with the model only when a repair slot is free. Any failed check falls back to the template. */
export async function draftReason(input: DraftInput): Promise<ReasonResult> {
  const fallback: ReasonResult = { text: templateFor(input.code), source: 'template' };
  if (input.budget.remainingRepair === 0) {
    return fallback;
  }
  input.budget.spend('repair');
  const prompt = loadPrompt('reason');
  const nonce = (input.nonce ?? newDelimiterId)();
  let raw: string;
  try {
    const reply = await input.client.complete({
      messages: [
        { role: 'system', content: prompt.text },
        {
          role: 'user',
          content: `Reason code: ${input.code}\nApproved fact: the code has placed a hold for this reason. Delimiter id ${nonce}.`,
        },
      ],
      maxTokens: 200,
      replySchema: {
        name: 'reason_draft',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'text', 'reasonCode'],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            text: { type: 'string', maxLength: 240 },
            reasonCode: { type: 'string', maxLength: 64 },
          },
        },
      },
    });
    raw = reply.text;
  } catch {
    return fallback;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
  const checked = DraftReply.safeParse(json);
  if (
    !checked.success ||
    checked.data.reasonCode !== input.code ||
    APPROVAL_WORDS.test(checked.data.text)
  ) {
    return fallback;
  }
  return { text: checked.data.text, source: 'model' };
}
