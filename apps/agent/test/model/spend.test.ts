import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DailyCaps } from '../../src/model/caps.js';
import { failoverModel, estimateUsdOf, usdOf, type Hop } from '../../src/model/failover.js';
import { DEFAULT_INVOICE_USD, ModelBudget } from '../../src/model/budget.js';
import { PROVIDERS, FAILOVER_ORDER } from '../../src/model/providers.js';
import type { ModelClient, ModelReply, ModelRequest } from '../../src/model/types.js';
import { ModelError } from '../../src/model/types.js';

const PRICE = { input: 1, output: 2 }; // dollars per million tokens: small enough to keep the arithmetic exact

const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'x'.repeat(200) }],
  maxTokens: 1_000,
  replySchema: null,
};

function counting(reply: ModelReply): ModelClient & { readonly calls: () => number } {
  let calls = 0;
  return {
    label: 'test:counting',
    calls: () => calls,
    complete: () => {
      calls += 1;
      return Promise.resolve(reply);
    },
  };
}

function priced(provider: string, client: ModelClient, price: Hop['price']): Hop {
  return { provider, model: `${provider}-model`, client, price };
}

describe('the dollar arithmetic', () => {
  it('prices a token count at the list price per million tokens', () => {
    expect(usdOf(PRICE, 1_000_000, 500_000)).toBeCloseTo(1 + 1, 9);
  });

  it('estimates the worst case from the prompt (measured conservatively) and the full output limit', () => {
    // 200 characters measure as 100 tokens; the output limit is 1000 tokens.
    expect(estimateUsdOf(PRICE, REQUEST)).toBeCloseTo((100 * 1 + 1000 * 2) / 1_000_000, 12);
    expect(estimateUsdOf(null, REQUEST)).toBe(0);
  });
});

describe('the invoice dollar limit', () => {
  it('refuses a call whose worst case would pass the invoice limit, and sends nothing', async () => {
    const client = counting({ text: '{}', promptTokens: 1, completionTokens: 1 });
    const budget = new ModelBudget(3, 0.000001); // a millionth of a dollar: no real call fits
    const error: unknown = await failoverModel({ hops: [priced('a', client, PRICE)] })
      .complete({ ...REQUEST, spend: budget })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).errorClass).toBe('SPEND_CAP');
    expect(client.calls()).toBe(0);
  });

  it('settles a reservation to the actual cost, so a cheap call leaves room for the next one', async () => {
    const client = counting({
      text: '{}',
      promptTokens: 10,
      completionTokens: 10,
      finishReason: 'stop',
    });
    const budget = new ModelBudget(3, DEFAULT_INVOICE_USD);
    const chain = failoverModel({ hops: [priced('a', client, PRICE)] });
    await chain.complete({ ...REQUEST, spend: budget });
    await chain.complete({ ...REQUEST, spend: budget });
    expect(client.calls()).toBe(2);
    expect(budget.usdReserved).toBeCloseTo(((10 * 1 + 10 * 2) / 1_000_000) * 2, 12);
  });

  it('gives a fresh invoice a fresh limit', () => {
    expect(new ModelBudget().usdLimit).toBe(DEFAULT_INVOICE_USD);
    expect(new ModelBudget().usdReserved).toBe(0);
  });

  it('refuses a limit that is not a positive number', () => {
    expect(() => new ModelBudget(3, 0)).toThrow(
      'the invoice dollar limit must be a positive number',
    );
  });
});

describe('the daily dollar cap', () => {
  it('refuses a call that would pass the day total, before it is sent', async () => {
    const client = counting({ text: '{}', promptTokens: 1, completionTokens: 1 });
    const caps = new DailyCaps({ file: null, maxUsd: 0.000001 });
    const error: unknown = await failoverModel({ hops: [priced('a', client, PRICE)], caps })
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).errorClass).toBe('DAILY_CAP');
    expect(client.calls()).toBe(0);
  });

  it('keeps its dollar total across a restart when it has a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'signoff-spend-'));
    const file = join(dir, 'daily-caps.json');
    const now = (): Date => new Date('2026-11-12T10:00:00Z');
    const first = new DailyCaps({ file, now, maxUsd: 3 });
    first.reserve(0.5);
    first.settle(10, 0.5, 0.25);
    const second = new DailyCaps({ file, now, maxUsd: 3 });
    expect(second.snapshot()).toMatchObject({ calls: 1, tokens: 10, usd: 0.25 });
  });

  it('keeps the total across days, so the total cap holds when the day rolls over', () => {
    let day = '2026-11-12';
    const now = (): Date => new Date(`${day}T10:00:00Z`);
    const caps = new DailyCaps({ file: null, now, maxUsd: 5, maxTotalUsd: 0.3 });
    caps.reserve(0.2);
    caps.settle(0, 0.2, 0.2);
    day = '2026-11-13';
    expect(caps.snapshot()).toMatchObject({ usd: 0, total: 0.2 });
    expect(() => { caps.reserve(0.2); }).toThrow('the total dollar cap would be exceeded');
  });

  it('gives a default daily cap of $5 and a default total of $10', () => {
    const caps = new DailyCaps({ file: null });
    expect(caps.maxUsd).toBe(5);
    expect(caps.maxTotalUsd).toBe(10);
  });

  it('refuses a daily cap that is not a positive dollar figure', () => {
    expect(() => new DailyCaps({ file: null, maxUsd: 0 })).toThrow(
      'the daily dollar cap must be a positive number',
    );
  });
});

describe('the failover order and the providers without a price', () => {
  it('sends a hop its own reply limit, and reserves its spend at that limit', async () => {
    const client = counting({ text: '{"ok":true}', promptTokens: 10, completionTokens: 10 });
    const sentLimits: number[] = [];
    const recording: ModelClient = {
      label: 'test:recording',
      complete: (request: ModelRequest) => {
        sentLimits.push(request.maxTokens);
        return client.complete(request);
      },
    };
    const hopWithLimit: Hop = { ...priced('meta', recording, PRICE), maxTokens: 8_000 };
    await failoverModel({ hops: [hopWithLimit] }).complete(REQUEST);
    expect(sentLimits).toEqual([8_000]);
  });

  it('refuses a hop whose larger reply limit would pass the invoice cap, although the caller limit would fit', async () => {
    const client = counting({ text: '{}', promptTokens: 1, completionTokens: 1 });
    // At 1,000 tokens the worst case is about 0.0021 dollars; at 8,000 it is about 0.0161. The invoice limit is 0.01.
    const budget = new ModelBudget(3, 0.01);
    const hopWithLimit: Hop = { ...priced('meta', client, PRICE), maxTokens: 8_000 };
    const error: unknown = await failoverModel({ hops: [hopWithLimit] })
      .complete({ ...REQUEST, spend: budget })
      .catch((caught: unknown) => caught);
    expect((error as ModelError).errorClass).toBe('SPEND_CAP');
    expect(client.calls()).toBe(0);
    const fits = counting({ text: '{}', promptTokens: 1, completionTokens: 1 });
    await failoverModel({ hops: [priced('plain', fits, PRICE)] }).complete({
      ...REQUEST,
      spend: new ModelBudget(3, 0.01),
    });
    expect(fits.calls()).toBe(1);
  });

  it('gives Meta an 8,000-token reply limit, with low reasoning effort', () => {
    expect(PROVIDERS.meta.replyTokens).toBe(8_000);
    expect(PROVIDERS.meta.requestExtras).toEqual({ reasoning_effort: 'low' });
  });

  it('puts Meta first, because it is the funded provider', () => {
    expect(FAILOVER_ORDER[0]).toBe('meta');
  });

  it('names the default Meta model as one with a schema, a price and a reasoning cap', () => {
    expect(PROVIDERS.meta.defaultModel).toBe('muse-ember-1.0');
    expect(PROVIDERS.meta.schemaReply).toBe(true);
    expect(PROVIDERS.meta.listPrice).toEqual({ input: 0.1, output: 0.5 });
    expect(PROVIDERS.meta.requestExtras).toEqual({ reasoning_effort: 'low' });
  });

  it('skips a provider with no list price when a dollar cap applies, and says so in the chain', async () => {
    const unpriced = counting({ text: '{}' });
    const priceless = counting({ text: '{"ok":true}' });
    const caps = new DailyCaps({ file: null });
    const reply = await failoverModel({
      hops: [
        priced('unpriced', unpriced, null),
        priced('priced', priceless, { input: 0, output: 0 }),
      ],
      caps,
    }).complete(REQUEST);
    expect(reply.text).toBe('{"ok":true}');
    expect(unpriced.calls()).toBe(0);
    expect(priceless.calls()).toBe(1);
  });
});
