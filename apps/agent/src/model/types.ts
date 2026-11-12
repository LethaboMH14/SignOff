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
 * The reply shape a call must match, as a JSON Schema. The provider is asked to follow it where it supports schemas,
 * and the reply is validated in code either way.
 */
export interface ReplySchema {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly replySchema: ReplySchema | null;
}

export interface ModelReply {
  readonly text: string;
}

export interface ModelClient {
  /** The provider and the model, for the audit trail. A label never holds a key. */
  readonly label: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

/**
 * A failed model call. Its message is safe to record: it never carries a key, a prompt, or the provider's body.
 */
export class ModelError extends Error {
  readonly status: number | null;
  readonly kind: ModelErrorKind;

  constructor(message: string, status: number | null = null, kind: ModelErrorKind = 'OTHER') {
    super(message);
    this.name = 'ModelError';
    this.status = status;
    this.kind = kind;
  }
}

/** Why a model call failed, as a fixed word. It is recorded so failed calls can be counted by cause. */
export type ModelErrorKind =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP'
  | 'UNREADABLE'
  | 'TOO_LARGE'
  | 'NOT_JSON'
  | 'NO_CHOICES'
  | 'CUT_OFF'
  | 'EMPTY'
  | 'OTHER';

/**
 * The failure as one token for the log, such as MODEL_TIMEOUT or MODEL_HTTP_429. It is built only from the fixed kind
 * and the numeric status, so it can never carry a key, a prompt or the provider's text.
 */
export function modelFailureToken(error: unknown): string {
  if (!(error instanceof ModelError)) {
    return 'MODEL_OTHER';
  }
  if (error.kind === 'HTTP' && error.status !== null) {
    return `MODEL_HTTP_${String(error.status)}`;
  }
  return `MODEL_${error.kind}`;
}
