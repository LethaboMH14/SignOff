import { assertModelAllowed, capabilitiesOf, type ProviderDefinition } from './providers.js';
import {
  ModelError,
  type ErrorClass,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
} from './types.js';

/**
 * A client for OpenAI-compatible chat completions, written over fetch. It sends the request with the provider's key in
 * the Authorization header only, never follows a redirect (which could carry the key elsewhere), and maps every failure
 * to a ModelError with a class (see types.ts). Nothing it throws carries a prompt, a key or the provider's body.
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
  readonly fetchImpl?: typeof fetch;
  /** Overrides the clock used to read an HTTP-date Retry-After header. Tests use it. */
  readonly now?: () => number;
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
  const schemaReply = capabilitiesOf(options.provider, options.model).schemaReply;
  const now = options.now ?? Date.now;

  return {
    label: `${options.provider.id}:${options.model}`,
    async complete(request: ModelRequest): Promise<ModelReply> {
      const formatField =
        request.replySchema !== null && schemaReply
          ? {
              response_format: {
                type: 'json_schema',
                // No strict flag: no provider here is documented for strict mode on this route (see providers.ts).
                json_schema: {
                  name: request.replySchema.name,
                  schema: request.replySchema.schema,
                },
              },
            }
          : {};
      const body = JSON.stringify({
        model: options.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: 0,
        stream: false,
        ...formatField,
        ...options.provider.requestExtras,
      });
      const response = await send(fetchImpl, url, options.apiKey, body, timeoutMs, now);
      return contentOf(response);
    },
  };
}

/**
 * The wording a provider uses for a daily quota, as Google's free tier returns it. A match is never logged. It only
 * selects the class, so the chain moves on rather than retrying a limit that will not clear for hours.
 */
const DAILY_QUOTA_PATTERN = /per day|day limit|daily|free_tier_requests/i;

/** Maps an HTTP status to a class. The body is never read into a message, so no provider text can reach a log. */
export function classOfStatus(status: number): ErrorClass {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500 && status <= 599) return 'SERVER';
  if (status >= 400 && status <= 499) return 'BAD_REQUEST';
  return 'UNKNOWN';
}

/**
 * Reads a Retry-After header: delta-seconds or an HTTP-date. Returns null when it is absent or unreadable, so the
 * caller falls back to its own backoff.
 */
export function retryAfterMsOf(value: string | null, now: number): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d{1,7}$/.test(text)) {
    return Number(text) * 1000;
  }
  // A signed or fractional number is not a Retry-After value. Date.parse would read it as a year, so it is refused here.
  if (/^[+-]?[\d.]+$/.test(text)) {
    return null;
  }
  const when = Date.parse(text);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now);
}

async function send(
  fetchImpl: typeof fetch,
  url: URL,
  apiKey: string,
  body: string,
  timeoutMs: number,
  now: () => number,
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
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    throw new ModelError(
      timedOut ? 'TIMEOUT' : 'NETWORK',
      timedOut ? 'the model request timed out' : 'the model request failed',
    );
  }
  if (!response.ok) {
    const status = response.status;
    // A 429 can mean a per-minute limit (retry shortly) or a daily quota (retry tomorrow). The body is read only to
    // tell them apart, and is never kept or logged.
    const body = status === 429 ? await response.text().catch(() => '') : '';
    await response.body?.cancel().catch(() => undefined);
    const retryAfterMs =
      status === 429 || status === 503
        ? retryAfterMsOf(response.headers.get('retry-after'), now())
        : null;
    const errorClass =
      status === 429 && DAILY_QUOTA_PATTERN.test(body) ? 'DAILY_QUOTA' : classOfStatus(status);
    throw new ModelError(errorClass, `the model provider returned HTTP ${String(status)}`, {
      status,
      retryAfterMs,
    });
  }
  return response;
}

/**
 * Reads the first choice. Anything other than a complete, non-empty reply is a ModelError with its class. The token
 * counts are kept on the reply, and on an error where the provider reported them, because a billed call that failed
 * still costs money.
 */
async function contentOf(response: Response): Promise<ModelReply> {
  const raw = await response.text().catch(() => null);
  if (raw === null) {
    throw new ModelError('READ_FAILED', 'the model reply could not be read');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_REPLY_BYTES) {
    throw new ModelError('REPLY_TOO_LARGE', 'the model reply is too large');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new ModelError('NOT_JSON', 'the model reply was not JSON');
  }
  const promptTokens = numberOrNull(fieldOf(fieldOf(payload, 'usage'), 'prompt_tokens'));
  const completionTokens = numberOrNull(fieldOf(fieldOf(payload, 'usage'), 'completion_tokens'));
  const choices = fieldOf(payload, 'choices');
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelError('NO_CHOICES', 'the model reply had no choices', {
      promptTokens,
      completionTokens,
    });
  }
  const choice: unknown = choices[0];
  const message = fieldOf(choice, 'message');
  const finishValue = fieldOf(choice, 'finish_reason');
  const finishReason = typeof finishValue === 'string' ? finishValue : null;
  const usage = { promptTokens, completionTokens, finishReason };
  const refusal = fieldOf(message, 'refusal');
  if (
    (typeof refusal === 'string' && refusal.trim().length > 0) ||
    finishReason === 'content_filter'
  ) {
    throw new ModelError('REFUSAL', 'the model declined to reply', usage);
  }
  if (finishReason === 'length') {
    throw new ModelError('LENGTH', 'the model reply was cut off by the token limit', usage);
  }
  const content = fieldOf(message, 'content');
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ModelError('EMPTY', 'the model reply was empty', usage);
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_REPLY_BYTES) {
    throw new ModelError('REPLY_TOO_LARGE', 'the model reply is too large', usage);
  }
  return { text: content, ...usage };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
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
