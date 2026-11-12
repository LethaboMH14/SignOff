import { describe, expect, it } from 'vitest';

import { createChatClient, MAX_REPLY_BYTES } from '../../src/model/chat-client.js';
import { PROVIDERS } from '../../src/model/providers.js';
import { ModelError, type ModelRequest } from '../../src/model/types.js';

// A placeholder that is not a credential. It lets the tests check that a key never reaches an error message.
const KEY = 'placeholder-key-for-tests';

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function bodyOf(recorded: Recorded | undefined): string {
  const body = recorded?.init.body;
  return typeof body === 'string' ? body : '';
}

function recordingFetch(respond: () => Response | Promise<Response>): {
  readonly fetchImpl: typeof fetch;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: urlOf(input), init: init ?? {} });
    return Promise.resolve().then(respond);
  };
  return { fetchImpl, calls };
}

function completion(content: unknown, finishReason = 'stop'): Response {
  const body = { choices: [{ message: { content }, finish_reason: finishReason }] };
  return new Response(JSON.stringify(body), { status: 200 });
}

const REQUEST: ModelRequest = {
  messages: [
    { role: 'system', content: 'Extract the fields.' },
    { role: 'user', content: 'Invoice text.' },
  ],
  maxTokens: 800,
  replySchema: { name: 'invoice', schema: { type: 'object' } },
};

function clientWith(fetchImpl: typeof fetch, extra: { jsonSchema?: boolean } = {}) {
  return createChatClient({
    provider: PROVIDERS.openrouter,
    model: 'google/gemma-4-31b-it:free',
    apiKey: KEY,
    fetchImpl,
    ...extra,
  });
}

describe('createChatClient request', () => {
  it('posts a strict JSON Schema request to the chat endpoint with the key in the header only', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{"ok":true}'));
    const reply = await clientWith(fetchImpl).complete(REQUEST);

    expect(reply.text).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.redirect).toBe('error');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(bodyOf(call)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'google/gemma-4-31b-it:free',
      max_tokens: 800,
      temperature: 0,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'invoice', schema: { type: 'object' }, strict: true },
      },
    });
    expect(body['messages']).toHaveLength(2);
  });

  it('asks for JSON mode when the request has no schema', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{}'));
    await clientWith(fetchImpl).complete({ ...REQUEST, replySchema: null });
    const body = JSON.parse(bodyOf(calls[0])) as Record<string, unknown>;
    expect(body['response_format']).toEqual({ type: 'json_object' });
  });

  it('asks for JSON mode when the model does not take schemas', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{}'));
    await clientWith(fetchImpl, { jsonSchema: false }).complete(REQUEST);
    const body = JSON.parse(bodyOf(calls[0])) as Record<string, unknown>;
    expect(body['response_format']).toEqual({ type: 'json_object' });
  });

  it('labels the client with provider and model, never with a key', () => {
    const { fetchImpl } = recordingFetch(() => completion('{}'));
    const client = clientWith(fetchImpl);
    expect(client.label).toBe('openrouter:google/gemma-4-31b-it:free');
    expect(client.label).not.toContain(KEY);
  });

  it('uses the Groq endpoint for that provider', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{}'));
    const client = createChatClient({
      provider: PROVIDERS.groq,
      model: 'openai/gpt-oss-120b',
      apiKey: KEY,
      fetchImpl,
    });
    await client.complete(REQUEST);
    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('calls the address it is given, and refuses a provider with no address at all', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{}'));
    const client = createChatClient({
      provider: PROVIDERS.meta,
      model: 'muse-spark-1.3',
      apiKey: KEY,
      baseUrl: 'https://meta.example.test/compat/v1',
      fetchImpl,
    });
    await client.complete(REQUEST);
    expect(calls[0]?.url).toBe('https://meta.example.test/compat/v1/chat/completions');
    expect(() =>
      createChatClient({ provider: PROVIDERS.meta, model: 'muse-spark-1.3', apiKey: KEY }),
    ).toThrow('no address is known for this provider');
  });

  it('defaults to a 60-second timeout signal', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{}'));
    await clientWith(fetchImpl).complete(REQUEST);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('honours an explicit timeout', async () => {
    const { fetchImpl, calls } = recordingFetch(() => completion('{}'));
    await createChatClient({
      provider: PROVIDERS.openrouter,
      model: 'google/gemma-4-31b-it:free',
      apiKey: KEY,
      timeoutMs: 1_000,
      fetchImpl,
    }).complete(REQUEST);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('createChatClient failures', () => {
  it('maps an HTTP error to a safe message with the status and no provider body', async () => {
    const { fetchImpl } = recordingFetch(
      () => new Response(`bad key ${KEY} echoed back`, { status: 401 }),
    );
    const error: unknown = await clientWith(fetchImpl)
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).status).toBe(401);
    expect((error as ModelError).message).toBe('the model provider returned HTTP 401');
    expect((error as ModelError).message).not.toContain(KEY);
  });

  it('maps a network failure without repeating its text', async () => {
    const { fetchImpl } = recordingFetch(() => {
      throw new TypeError(`fetch failed for ${KEY}`);
    });
    const error: unknown = await clientWith(fetchImpl)
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).message).toBe('the model request failed');
    expect((error as ModelError).message).not.toContain(KEY);
    expect((error as ModelError).status).toBeNull();
  });

  it('maps a timeout to its own message', async () => {
    const timeout = new Error('the operation timed out');
    timeout.name = 'TimeoutError';
    const { fetchImpl } = recordingFetch(() => {
      throw timeout;
    });
    const error: unknown = await clientWith(fetchImpl)
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).message).toBe('the model request timed out');
    expect((error as ModelError).kind).toBe('TIMEOUT');
  });

  it('maps an abort to the timeout message as well', async () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    const { fetchImpl } = recordingFetch(() => {
      throw aborted;
    });
    const error: unknown = await clientWith(fetchImpl)
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).message).toBe('the model request timed out');
  });

  it('refuses a reply whose body cannot be read', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const { fetchImpl } = recordingFetch(() => new Response(broken, { status: 200 }));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply could not be read',
    );
  });

  it('refuses a reply that is not JSON', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('<html>', { status: 200 }));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply was not JSON',
    );
  });

  it('refuses a reply without choices', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('{"id":"x"}', { status: 200 }));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply had no choices',
    );
  });

  it('refuses an empty choices array', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('{"choices":[]}', { status: 200 }));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply had no choices',
    );
  });

  it('refuses a reply with no text content', async () => {
    const { fetchImpl } = recordingFetch(() => completion(null));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply was empty',
    );
  });

  it('refuses a reply that is only whitespace', async () => {
    const { fetchImpl } = recordingFetch(() => completion('   '));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply was empty',
    );
  });

  it('refuses a reply cut off by the token limit', async () => {
    const { fetchImpl } = recordingFetch(() => completion('{"a":', 'length'));
    await expect(clientWith(fetchImpl).complete(REQUEST)).rejects.toThrow(
      'the model reply was cut off',
    );
  });

  it('refuses a reply that is too large, in the body or in the content', async () => {
    const big = 'x'.repeat(MAX_REPLY_BYTES + 1);
    const { fetchImpl: bodyFetch } = recordingFetch(() => new Response(big, { status: 200 }));
    await expect(clientWith(bodyFetch).complete(REQUEST)).rejects.toThrow(
      'the model reply is too large',
    );
    const { fetchImpl: contentFetch } = recordingFetch(() => completion(big));
    await expect(clientWith(contentFetch).complete(REQUEST)).rejects.toThrow(
      'the model reply is too large',
    );
  });
});

describe('createChatClient guards', () => {
  it('refuses an Anthropic model', () => {
    expect(() =>
      createChatClient({
        provider: PROVIDERS.openrouter,
        model: 'anthropic/claude-sonnet-5-5',
        apiKey: KEY,
      }),
    ).toThrow('Anthropic and Claude models are not used by this project');
  });

  it('refuses an empty key', () => {
    expect(() =>
      createChatClient({
        provider: PROVIDERS.openrouter,
        model: 'google/gemma-4-31b-it:free',
        apiKey: '   ',
      }),
    ).toThrow('the provider key is empty');
  });

  it('uses the global fetch when none is given', () => {
    const client = createChatClient({
      provider: PROVIDERS.openrouter,
      model: 'google/gemma-4-31b-it:free',
      apiKey: KEY,
    });
    expect(client.label).toBe('openrouter:google/gemma-4-31b-it:free');
  });
});
