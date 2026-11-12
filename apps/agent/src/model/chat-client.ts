import { assertModelAllowed, type ProviderDefinition } from './providers.js';
import {
  ModelError,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
  type ReplySchema,
} from './types.js';

/**
 * A client for OpenAI-compatible chat completions, written over fetch. It sends the request with the provider's key
 * in the Authorization header only, never follows a redirect (which could carry the key elsewhere), and maps every
 * failure to a ModelError whose message is safe to record.
 */

/** A reply larger than this is refused. A reply is one JSON object of a few hundred bytes. */
export const MAX_REPLY_BYTES = 256 * 1024;

const DEFAULT_TIMEOUT_MS = 60_000;

export interface ChatClientOptions {
  readonly provider: ProviderDefinition;
  readonly model: string;
  /** The address to call. Defaults to the provider's own address. Meta's comes from the operator's environment. */
  readonly baseUrl?: string;
  /** The provider key. It stays in memory for the run and is never logged, echoed or written to a file. */
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** False for a model that does not accept a JSON Schema reply format. The reply is still validated in code. */
  readonly jsonSchema?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export function createChatClient(options: ChatClientOptions): ModelClient {
  assertModelAllowed(options.model);
  if (options.apiKey.trim().length === 0) {
    throw new RangeError('the provider key is empty');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.baseUrl ?? options.provider.baseUrl;
  if (base === null) {
    throw new RangeError('no address is known for this provider');
  }
  const url = new URL('chat/completions', `${base}/`);
  const jsonSchema = options.jsonSchema ?? true;

  return {
    label: `${options.provider.id}:${options.model}`,
    async complete(request: ModelRequest): Promise<ModelReply> {
      const body = JSON.stringify({
        model: options.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: 0,
        stream: false,
        response_format: responseFormatOf(request.replySchema, jsonSchema),
      });
      const response = await send(fetchImpl, url, options.apiKey, body, timeoutMs);
      return { text: await contentOf(response) };
    },
  };
}

function responseFormatOf(
  replySchema: ReplySchema | null,
  jsonSchema: boolean,
): Readonly<Record<string, unknown>> {
  if (replySchema !== null && jsonSchema) {
    return {
      type: 'json_schema',
      json_schema: { name: replySchema.name, schema: replySchema.schema, strict: true },
    };
  }
  return { type: 'json_object' };
}

async function send(
  fetchImpl: typeof fetch,
  url: URL,
  apiKey: string,
  body: string,
  timeoutMs: number,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-title': 'SignOFF',
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = nameOf(error);
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ModelError('the model request timed out', null, 'TIMEOUT');
    }
    throw new ModelError('the model request failed', null, 'NETWORK');
  }
  if (!response.ok) {
    throw new ModelError(
      `the model provider returned HTTP ${String(response.status)}`,
      response.status,
      'HTTP',
    );
  }
  return response;
}

/** Reads the first choice's text. Anything other than a complete, non-empty reply is an error. */
async function contentOf(response: Response): Promise<string> {
  const raw = await response.text().catch(() => null);
  if (raw === null) {
    throw new ModelError('the model reply could not be read', null, 'UNREADABLE');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_REPLY_BYTES) {
    throw new ModelError('the model reply is too large', null, 'TOO_LARGE');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new ModelError('the model reply was not JSON', null, 'NOT_JSON');
  }
  const choices = fieldOf(payload, 'choices');
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelError('the model reply had no choices', null, 'NO_CHOICES');
  }
  const choice: unknown = choices[0];
  const content = fieldOf(fieldOf(choice, 'message'), 'content');
  if (fieldOf(choice, 'finish_reason') === 'length') {
    throw new ModelError('the model reply was cut off', null, 'CUT_OFF');
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ModelError('the model reply was empty', null, 'EMPTY');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_REPLY_BYTES) {
    throw new ModelError('the model reply is too large', null, 'TOO_LARGE');
  }
  return content;
}

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const field: unknown = Reflect.get(value, key);
  return field;
}

function nameOf(error: unknown): string {
  const name = fieldOf(error, 'name');
  return typeof name === 'string' ? name : '';
}
