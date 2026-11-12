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

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ModelError';
    this.status = status;
  }
}
