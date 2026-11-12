import { describe, expect, it } from 'vitest';

import { classOfStatus, createChatClient, retryAfterMsOf } from '../../src/model/chat-client.js';
import { PROVIDERS } from '../../src/model/providers.js';
import { ModelError, type ModelRequest } from '../../src/model/types.js';

const KEY = 'placeholder-key-for-tests';
const NOW = Date.parse('2026-11-12T12:00:00Z');
const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'Invoice text.' }],
  maxTokens: 100,
  replySchema: null,
};

function clientReturning(response: () => Response | Promise<Response>, fetchFails = false) {
  const fetchImpl = (): Promise<Response> => {
    if (fetchFails) {
      return Promise.reject(Object.assign(new Error('socket hang up'), { name: 'TypeError' }));
    }
    return Promise.resolve().then(response);
  };
  return createChatClient({
    provider: PROVIDERS.groq,
    model: 'openai/gpt-oss-120b',
    apiKey: KEY,
    fetchImpl,
    now: () => NOW,
  });
}

async function failureOf(client: {
  complete: (r: ModelRequest) => Promise<unknown>;
}): Promise<ModelError> {
  const error: unknown = await client.complete(REQUEST).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ModelError);
  return error as ModelError;
}

function body(
  content: unknown,
  finish: string | null,
  extra: Record<string, unknown> = {},
): Response {
  const payload = {
    choices: [{ message: { content, ...extra }, finish_reason: finish }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  };
  return new Response(JSON.stringify(payload), { status: 200 });
}

describe('classOfStatus', () => {
  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [408, 'TIMEOUT'],
    [429, 'RATE_LIMIT'],
    [400, 'BAD_REQUEST'],
    [404, 'BAD_REQUEST'],
    [422, 'BAD_REQUEST'],
    [500, 'SERVER'],
    [503, 'SERVER'],
    [302, 'UNKNOWN'],
  ] as const)('maps HTTP %i to %s', (status, errorClass) => {
    expect(classOfStatus(status)).toBe(errorClass);
  });
});

describe('retryAfterMsOf', () => {
  it('reads delta-seconds', () => {
    expect(retryAfterMsOf('7', NOW)).toBe(7000);
    expect(retryAfterMsOf(' 0 ', NOW)).toBe(0);
  });

  it('reads an HTTP-date relative to now, never below zero', () => {
    expect(retryAfterMsOf('Thu, 12 Nov 2026 12:00:30 GMT', NOW)).toBe(30_000);
    expect(retryAfterMsOf('Thu, 12 Nov 2026 11:00:00 GMT', NOW)).toBe(0);
  });

  it('returns null when the header is absent or unreadable', () => {
    expect(retryAfterMsOf(null, NOW)).toBeNull();
    expect(retryAfterMsOf('soon', NOW)).toBeNull();
    expect(retryAfterMsOf('-5', NOW)).toBeNull();
  });
});

describe('createChatClient failure classes', () => {
  it('classes a 429 as RATE_LIMIT and keeps its Retry-After', async () => {
    const error = await failureOf(
      clientReturning(
        () =>
          new Response('{"error":"slow down"}', { status: 429, headers: { 'retry-after': '12' } }),
      ),
    );
    expect(error.errorClass).toBe('RATE_LIMIT');
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(12_000);
    expect(error.message).not.toContain('slow down');
  });

  it('classes a 429 that reports a daily quota as DAILY_QUOTA, which is not retried', async () => {
    const body =
      'Quota exceeded for metric: free_tier_requests, limit: 20. Generate content requests per day limit exceeded';
    const error = await failureOf(clientReturning(() => new Response(body, { status: 429 })));
    expect(error.errorClass).toBe('DAILY_QUOTA');
    expect(error.message).not.toContain('free_tier');
  });

  it('classes a 401 as AUTH, without its body and without the key', async () => {
    const error = await failureOf(
      clientReturning(() => new Response('bad key placeholder', { status: 401 })),
    );
    expect(error.errorClass).toBe('AUTH');
    expect(error.message).toBe('the model provider returned HTTP 401');
    expect(error.message).not.toContain(KEY);
  });

  it('classes a 503 as SERVER and reads its Retry-After', async () => {
    const error = await failureOf(
      clientReturning(() => new Response('', { status: 503, headers: { 'retry-after': '3' } })),
    );
    expect(error).toMatchObject({ errorClass: 'SERVER', status: 503, retryAfterMs: 3000 });
  });

  it('classes a network failure as NETWORK', async () => {
    const error = await failureOf(clientReturning(() => new Response('{}'), true));
    expect(error.errorClass).toBe('NETWORK');
  });

  it('classes a reply cut off by the token limit as LENGTH, and keeps the billed tokens', async () => {
    const error = await failureOf(clientReturning(() => body('{"schemaVer', 'length')));
    expect(error).toMatchObject({
      errorClass: 'LENGTH',
      finishReason: 'length',
      promptTokens: 120,
      completionTokens: 30,
    });
  });

  it('classes a provider refusal as REFUSAL, both as a refusal field and as a content filter', async () => {
    expect(
      (await failureOf(clientReturning(() => body(null, 'stop', { refusal: 'no' })))).errorClass,
    ).toBe('REFUSAL');
    expect((await failureOf(clientReturning(() => body('', 'content_filter')))).errorClass).toBe(
      'REFUSAL',
    );
  });

  it('classes an empty content as EMPTY and no choices as NO_CHOICES', async () => {
    expect((await failureOf(clientReturning(() => body(null, 'stop')))).errorClass).toBe('EMPTY');
    const none = new Response(JSON.stringify({ choices: [] }), { status: 200 });
    expect((await failureOf(clientReturning(() => none))).errorClass).toBe('NO_CHOICES');
  });

  it('classes a reply that is not JSON as NOT_JSON', async () => {
    expect(
      (await failureOf(clientReturning(() => new Response('<html>', { status: 200 })))).errorClass,
    ).toBe('NOT_JSON');
  });

  it('returns the reply text with its finish reason and reported tokens on success', async () => {
    const reply = await clientReturning(() => body('{"ok":true}', 'stop')).complete(REQUEST);
    expect(reply).toEqual({
      text: '{"ok":true}',
      finishReason: 'stop',
      promptTokens: 120,
      completionTokens: 30,
    });
  });

  it('reports no tokens when the provider sends no usage block', async () => {
    const bare = new Response(
      JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }),
      {
        status: 200,
      },
    );
    const reply = await clientReturning(() => bare).complete(REQUEST);
    expect(reply.promptTokens).toBeNull();
    expect(reply.completionTokens).toBeNull();
  });
});
