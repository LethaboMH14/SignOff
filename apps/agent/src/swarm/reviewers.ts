import type { ChatMessage, ModelClient } from '../model/types.js';
import { INSTRUCTION_HIERARCHY, wrapItem } from '../prompts/envelope.js';
import { loadPrompt, newDelimiterId, type PromptFile } from '../prompts/registry.js';
import type { RoleContext } from '../context/types.js';

import { SwarmBudget } from './budget.js';
import { REVIEW_SCHEMAS, replySchemaOf, type ReviewerRole, type ReviewReply } from './schemas.js';

/**
 * One reviewer call. A reviewer sees only its own RoleContext (built by buildContext), so the two reviewers never share a
 * prompt, and they run in parallel (see runReviewers). The reply is validated by a strict schema; an invalid reply is
 * returned as status "invalid" with issue codes, never with the reply text, so the judge can ask for one repair.
 */

export type ReviewStatus = 'ok' | 'invalid' | 'failed';

export interface ReviewOutcome {
  readonly role: ReviewerRole;
  readonly model: string;
  readonly status: ReviewStatus;
  readonly reply: ReviewReply | null;
  /** Path and rule only, for example "verdict: invalid_value". Never a value from the invoice. */
  readonly issues: readonly string[];
  readonly promptVersion: string;
  readonly promptSha256: string;
  readonly contextTokens: number;
  readonly replyChars: number;
  readonly latencyMs: number;
}

export interface ReviewInput {
  readonly role: ReviewerRole;
  readonly context: RoleContext;
  readonly client: ModelClient;
  readonly budget: SwarmBudget;
  /** Set when this call is the one repair. The issue codes say what to fix, and the invoice text does not change. */
  readonly repairIssues?: readonly string[];
  readonly now?: () => number;
  readonly nonce?: () => string;
  readonly prompt?: PromptFile;
}

export function reviewMessages(
  prompt: PromptFile,
  context: RoleContext,
  nonce: string,
  repairIssues: readonly string[] | undefined,
): ChatMessage[] {
  const items = context.items.map((item) => wrapItem(item, nonce)).join('\n\n');
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.text },
    {
      role: 'user',
      content: [
        INSTRUCTION_HIERARCHY,
        `Review this invoice using only the items below. Their delimiter id is ${nonce}.`,
        items,
        'Reply with one JSON object that matches the schema.',
      ].join('\n\n'),
    },
  ];
  if (repairIssues !== undefined && repairIssues.length > 0) {
    messages.push({
      role: 'user',
      content: [
        'Your previous reply did not pass these checks:',
        ...repairIssues.slice(0, 10).map((issue) => `- ${issue}`),
        'Reply again with one JSON object that matches the schema. Do not change the rules; the items have not changed.',
      ].join('\n'),
    });
  }
  return messages;
}

export function issuesOf(error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[];
}): string[] {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.map(String).join('.') || 'root'}: ${issue.code}`);
}

export async function runReviewer(input: ReviewInput): Promise<ReviewOutcome> {
  const prompt = input.prompt ?? loadPrompt(input.role);
  const now = input.now ?? Date.now;
  const started = now();
  const model = input.client.label;
  const base = {
    role: input.role,
    model,
    promptVersion: prompt.version,
    promptSha256: prompt.sha256,
    contextTokens: input.context.tokensUsed,
  };

  input.budget.spend(input.repairIssues === undefined ? 'initial' : 'repair');
  const nonce = (input.nonce ?? newDelimiterId)();
  const schema = replySchemaOf(input.role);
  let text: string;
  try {
    const reply = await input.client.complete({
      messages: reviewMessages(prompt, input.context, nonce, input.repairIssues),
      maxTokens: 700,
      replySchema: schema,
    });
    text = reply.text;
  } catch {
    return {
      ...base,
      status: 'failed',
      reply: null,
      issues: ['call: failed'],
      replyChars: 0,
      latencyMs: now() - started,
    };
  }

  const latencyMs = now() - started;
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return {
      ...base,
      status: 'invalid',
      reply: null,
      issues: ['root: not_json'],
      replyChars: text.length,
      latencyMs,
    };
  }
  const checked = REVIEW_SCHEMAS[input.role].safeParse(json);
  if (!checked.success) {
    return {
      ...base,
      status: 'invalid',
      reply: null,
      issues: issuesOf(checked.error),
      replyChars: text.length,
      latencyMs,
    };
  }
  return {
    ...base,
    status: 'ok',
    reply: checked.data,
    issues: [],
    replyChars: text.length,
    latencyMs,
  };
}

/** Runs the two reviewers at the same time. Each has its own context and its own call; neither sees the other's reply. */
export async function runReviewers(
  inputs: readonly ReviewInput[],
): Promise<readonly ReviewOutcome[]> {
  const outcomes = await Promise.all(inputs.map((input) => runReviewer(input)));
  return [...outcomes].sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
}
