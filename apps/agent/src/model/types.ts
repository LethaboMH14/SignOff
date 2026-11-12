/**
 * The agent's only route to a language model. Every call goes through a ModelClient, so the provider can change
 * without changing the pipeline, and every call can be counted against the budget (see budget.ts).
 */

export type ChatRole = 'system' | 'user';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

/**
 * The reply shape a call must match, as a JSON Schema. A provider is asked to follow it only where its documentation
 * says it supports a schema reply (see providers.ts). The reply is validated in code in every case.
 */
export interface ReplySchema {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

/**
 * The dollar spend for one invoice. Each attempt reserves its worst-case cost before it is sent and settles it to the
 * actual cost after. A reservation that would pass the invoice's limit throws a SPEND_CAP error, so the call is not sent.
 */
export interface SpendTracker {
  reserveUsd(estimateUsd: number): void;
  settleUsd(estimateUsd: number, actualUsd: number): void;
}

export interface ModelRequest {
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly replySchema: ReplySchema | null;
  /** The invoice's spend, when the call is one of an invoice's calls. Absent for a call that is not part of one. */
  readonly spend?: SpendTracker;
}

export interface ModelReply {
  readonly text: string;
  /** The provider's finish reason, as it reported it. Null when the provider sent none. */
  readonly finishReason?: string | null;
  /** Tokens the provider reported for the call. Null when it reported none. */
  readonly promptTokens?: number | null;
  readonly completionTokens?: number | null;
}

export interface ModelClient {
  /** The provider and the model, for the audit trail. A label never holds a key. */
  readonly label: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

/**
 * Why a model call failed. Every value is a fixed token, so it is safe to record. None of them carries a prompt, a key
 * or the provider's body.
 */
export const ERROR_CLASSES = [
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMIT',
  'SERVER',
  'AUTH',
  'BAD_REQUEST',
  'REFUSAL',
  'LENGTH',
  'EMPTY',
  'NOT_JSON',
  'SCHEMA_MISMATCH',
  'NO_CHOICES',
  'REPLY_TOO_LARGE',
  'READ_FAILED',
  'UNKNOWN',
  'NO_KEY',
  'CHAIN_EXHAUSTED',
  'BUDGET_EXHAUSTED',
  'DAILY_CAP',
  'DAILY_QUOTA',
  'SPEND_CAP',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** The classes that a retry against the same provider may clear. The others go straight to the next provider. */
export const RETRYABLE_CLASSES: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMIT',
  'SERVER',
]);

export interface ModelErrorDetail {
  readonly status?: number | null;
  readonly retryAfterMs?: number | null;
  readonly finishReason?: string | null;
  readonly promptTokens?: number | null;
  readonly completionTokens?: number | null;
  /** For a chain that gave up: the class of each attempt, in order, e.g. "groq:RATE_LIMIT". */
  readonly chain?: readonly string[];
}

/**
 * A failed model call. Its message is safe to record: it never carries a key, a prompt, or the provider's body. The
 * class and the HTTP status say why it failed, and the token counts say what was billed.
 */
export class ModelError extends Error {
  readonly errorClass: ErrorClass;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly finishReason: string | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly chain: readonly string[];

  constructor(errorClass: ErrorClass, message: string, detail: ModelErrorDetail = {}) {
    super(message);
    this.name = 'ModelError';
    this.errorClass = errorClass;
    this.status = detail.status ?? null;
    this.retryAfterMs = detail.retryAfterMs ?? null;
    this.finishReason = detail.finishReason ?? null;
    this.promptTokens = detail.promptTokens ?? null;
    this.completionTokens = detail.completionTokens ?? null;
    this.chain = detail.chain ?? [];
  }
}
