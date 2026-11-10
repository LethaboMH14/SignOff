import { describe, expect, it } from 'vitest';

import { intervalOf, MAX_INTERVAL_MS, pacedModel } from '../../src/model/pacing.js';
import type { ModelClient, ModelRequest } from '../../src/model/types.js';

const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'x' }],
  maxTokens: 10,
  replySchema: null,
};

function countingClient(): ModelClient & { readonly calls: number } {
  const state = { calls: 0 };
  return {
    label: 'test:model',
    get calls() {
      return state.calls;
    },
    complete() {
      state.calls += 1;
      return Promise.resolve({ text: '{}' });
    },
  };
}

describe('intervalOf', () => {
  it('is zero when no interval is given, and accepts a whole number within the limit', () => {
    expect(intervalOf(undefined)).toBe(0);
    expect(intervalOf('0')).toBe(0);
    expect(intervalOf('6000')).toBe(6000);
    expect(intervalOf(String(MAX_INTERVAL_MS))).toBe(MAX_INTERVAL_MS);
  });

  it('refuses anything that is not a whole number of milliseconds within the limit', () => {
    for (const text of ['-1', '1.5', 'abc', '', '999999', '60001']) {
      expect(() => intervalOf(text)).toThrow(RangeError);
    }
  });
});

describe('pacedModel', () => {
  it('returns the client unchanged when the interval is zero', () => {
    const client = countingClient();
    expect(pacedModel(client, 0)).toBe(client);
  });

  it('waits between calls: the second waits about one interval, the third about two', async () => {
    const waits: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    };
    const inner = countingClient();
    const paced = pacedModel(inner, 1_000, sleep);
    expect(paced.label).toBe('test:model');
    await paced.complete(REQUEST);
    await paced.complete(REQUEST);
    await paced.complete(REQUEST);
    expect(inner.calls).toBe(3);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(900);
    expect(waits[0]).toBeLessThanOrEqual(1_000);
    expect(waits[1]).toBeGreaterThan(1_900);
    expect(waits[1]).toBeLessThanOrEqual(2_000);
  });
});
