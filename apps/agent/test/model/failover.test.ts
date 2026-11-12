import { describe, expect, it } from 'vitest';

import { DailyCaps } from '../../src/model/caps.js';
import { backoffMs, failoverModel, type Attempt, type Hop } from '../../src/model/failover.js';
import type { ModelClient, ModelReply, ModelRequest } from '../../src/model/types.js';
import { ModelError, type ErrorClass } from '../../src/model/types.js';

const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'x' }],
  maxTokens: 10,
  replySchema: null,
};

type Step = ModelReply | ModelError;

/** A client that gives its steps in order, and counts its calls. */
function scripted(
  label: string,
  steps: readonly Step[],
): ModelClient & { readonly calls: () => number } {
  let index = 0;
  return {
    label,
    calls: () => index,
    complete: () => {
      const step = steps.at(index);
      index += 1;
      if (step === undefined) {
        return Promise.reject(new ModelError('UNKNOWN', 'no scripted step left'));
      }
      return step instanceof ModelError ? Promise.reject(step) : Promise.resolve(step);
    },
  };
}

const OK: ModelReply = {
  text: '{"ok":true}',
  finishReason: 'stop',
  promptTokens: 10,
  completionTokens: 5,
};

/** A hop with a free price, so a dollar cap, when one applies, reserves nothing and never refuses. */
function hop(provider: string, client: ModelClient): Hop {
  return { provider, model: `${provider}-model`, client, price: { input: 0, output: 0 } };
}

function recorder(): {
  readonly attempts: Attempt[];
  readonly sink: { record: (a: Attempt) => void };
} {
  const attempts: Attempt[] = [];
  return { attempts, sink: { record: (attempt) => attempts.push(attempt) } };
}

/** A sleep that records the waits and does not wait. */
function sleeps(): { readonly waits: number[]; readonly sleep: (ms: number) => Promise<void> } {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

describe('failoverModel', () => {
  it('returns the first provider reply and makes no other call when it succeeds', async () => {
    const first = scripted('a', [OK]);
    const second = scripted('b', [OK]);
    const log = recorder();
    const reply = await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      sink: log.sink,
    }).complete(REQUEST);
    expect(reply.text).toBe(OK.text);
    expect(first.calls()).toBe(1);
    expect(second.calls()).toBe(0);
    expect(log.attempts).toEqual([
      expect.objectContaining({
        provider: 'a',
        attempt: 1,
        outcome: 'OK',
        promptTokens: 10,
        completionTokens: 5,
      }),
    ]);
  });

  it('retries the same provider once after a rate limit, honouring Retry-After, and then succeeds', async () => {
    const first = scripted('a', [
      new ModelError('RATE_LIMIT', 'limited', { status: 429, retryAfterMs: 3000 }),
      OK,
    ]);
    const second = scripted('b', [OK]);
    const { sleep, waits } = sleeps();
    const log = recorder();
    const reply = await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      sink: log.sink,
      sleep,
      random: () => 0,
    }).complete(REQUEST);
    expect(reply.text).toBe(OK.text);
    expect(first.calls()).toBe(2);
    expect(second.calls()).toBe(0);
    expect(waits).toEqual([3000]);
    expect(
      log.attempts.map((attempt) => [attempt.provider, attempt.attempt, attempt.outcome]),
    ).toEqual([
      ['a', 1, 'RATE_LIMIT'],
      ['a', 2, 'OK'],
    ]);
  });

  it('makes at most one retry per provider, then moves to the next provider', async () => {
    const first = scripted('a', [
      new ModelError('SERVER', 'x', { status: 503 }),
      new ModelError('SERVER', 'x', { status: 503 }),
      OK,
    ]);
    const second = scripted('b', [OK]);
    const { sleep } = sleeps();
    const reply = await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      sleep,
      random: () => 0,
    }).complete(REQUEST);
    expect(reply.text).toBe(OK.text);
    expect(first.calls()).toBe(2);
    expect(second.calls()).toBe(1);
  });

  it('does not retry a class a retry cannot clear, and moves on at once', async () => {
    for (const errorClass of [
      'AUTH',
      'BAD_REQUEST',
      'LENGTH',
      'REFUSAL',
      'EMPTY',
      'NOT_JSON',
    ] as const) {
      const first = scripted('a', [new ModelError(errorClass, 'x'), OK]);
      const second = scripted('b', [OK]);
      const { sleep, waits } = sleeps();
      await failoverModel({ hops: [hop('a', first), hop('b', second)], sleep }).complete(REQUEST);
      expect(first.calls()).toBe(1);
      expect(second.calls()).toBe(1);
      expect(waits).toEqual([]);
    }
  });

  it('does not retry when Retry-After is longer than the backoff ceiling, and moves on', async () => {
    const first = scripted('a', [new ModelError('RATE_LIMIT', 'x', { retryAfterMs: 600_000 }), OK]);
    const second = scripted('b', [OK]);
    const { sleep, waits } = sleeps();
    await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      sleep,
      maxDelayMs: 20_000,
    }).complete(REQUEST);
    expect(first.calls()).toBe(1);
    expect(second.calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  it('reports CHAIN_EXHAUSTED with the class of each attempt, and never a provider body', async () => {
    const first = scripted('a', [
      new ModelError('RATE_LIMIT', 'x'),
      new ModelError('RATE_LIMIT', 'x'),
    ]);
    const second = scripted('b', [new ModelError('TIMEOUT', 'x'), new ModelError('TIMEOUT', 'x')]);
    const { sleep } = sleeps();
    const error: unknown = await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      sleep,
      random: () => 0,
    })
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).errorClass).toBe('CHAIN_EXHAUSTED');
    expect((error as ModelError).chain).toEqual([
      'a:RATE_LIMIT',
      'a:RATE_LIMIT',
      'b:TIMEOUT',
      'b:TIMEOUT',
    ]);
  });

  it('stops at the attempt ceiling for one call, however many providers remain', async () => {
    const hops = ['a', 'b', 'c'].map((id) =>
      hop(id, scripted(id, [new ModelError('NETWORK', 'x'), new ModelError('NETWORK', 'x')])),
    );
    const { sleep } = sleeps();
    const error: unknown = await failoverModel({ hops, sleep, random: () => 0, attemptsPerCall: 3 })
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).errorClass).toBe('CHAIN_EXHAUSTED');
    expect((error as ModelError).message).toContain('attempt limit');
    expect((error as ModelError).chain).toHaveLength(3);
  });

  it('counts every attempt against the daily caps and stops at the call cap without another HTTP call', async () => {
    const first = scripted('a', [
      new ModelError('RATE_LIMIT', 'x'),
      new ModelError('RATE_LIMIT', 'x'),
    ]);
    const second = scripted('b', [OK]);
    const { sleep } = sleeps();
    const caps = new DailyCaps({ maxCalls: 2, file: null });
    const error: unknown = await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      caps,
      sleep,
      random: () => 0,
    })
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).errorClass).toBe('DAILY_CAP');
    expect(first.calls()).toBe(2);
    expect(second.calls()).toBe(0);
  });

  it('gives the daily cap error on the first call once the cap is used up', async () => {
    const caps = new DailyCaps({ maxCalls: 1, file: null });
    const client = failoverModel({ hops: [hop('a', scripted('a', [OK, OK]))], caps });
    await client.complete(REQUEST);
    const error: unknown = await client.complete(REQUEST).catch((caught: unknown) => caught);
    expect((error as ModelError).errorClass).toBe('DAILY_CAP');
  });

  it('keeps the token count of a failed attempt that reported one, so a billed failure is counted', async () => {
    const lengthed = new ModelError('LENGTH', 'x', {
      finishReason: 'length',
      promptTokens: 100,
      completionTokens: 4000,
    });
    const first = scripted('a', [lengthed]);
    const second = scripted('b', [OK]);
    const caps = new DailyCaps({ file: null });
    const log = recorder();
    await failoverModel({
      hops: [hop('a', first), hop('b', second)],
      caps,
      sink: log.sink,
    }).complete(REQUEST);
    expect(log.attempts[0]).toMatchObject({
      outcome: 'LENGTH',
      promptTokens: 100,
      completionTokens: 4000,
    });
    expect(caps.snapshot().tokens).toBe(4100 + 15);
  });

  it('turns an unexpected error into UNKNOWN and does not retry it', async () => {
    const broken: ModelClient = {
      label: 'a',
      complete: () => Promise.reject(new TypeError('unexpected')),
    };
    const log = recorder();
    const error: unknown = await failoverModel({ hops: [hop('a', broken)], sink: log.sink })
      .complete(REQUEST)
      .catch((caught: unknown) => caught);
    expect((error as ModelError).errorClass).toBe('CHAIN_EXHAUSTED');
    expect((error as ModelError).chain).toEqual(['a:UNKNOWN']);
    expect(log.attempts).toHaveLength(1);
  });

  it('refuses an empty chain', () => {
    expect(() => failoverModel({ hops: [] })).toThrow('the provider chain is empty');
  });
});

describe('backoffMs', () => {
  it('doubles from the base, keeps half of each wait fixed, and never exceeds the ceiling', () => {
    expect(backoffMs(1, 1000, 20_000, 0)).toBe(500);
    expect(backoffMs(1, 1000, 20_000, 1)).toBe(1000);
    expect(backoffMs(2, 1000, 20_000, 0)).toBe(1000);
    expect(backoffMs(3, 1000, 20_000, 0)).toBe(2000);
    expect(backoffMs(20, 1000, 20_000, 0.999)).toBeLessThanOrEqual(20_000);
  });

  it('spreads retries with the random factor, so two waits can differ', () => {
    expect(backoffMs(2, 1000, 20_000, 0.25)).not.toBe(backoffMs(2, 1000, 20_000, 0.75));
  });
});

describe('error classes', () => {
  it('uses only fixed class names', () => {
    const classes: ErrorClass[] = ['TIMEOUT', 'RATE_LIMIT', 'DAILY_CAP'];
    expect(classes).toHaveLength(3);
  });
});
