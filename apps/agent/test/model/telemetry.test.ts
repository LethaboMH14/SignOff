import { describe, expect, it } from 'vitest';

import type { Attempt } from '../../src/model/failover.js';
import { CallLedger, costOf, summariseByProvider, sumOf } from '../../src/model/telemetry.js';
import { PROVIDERS } from '../../src/model/providers.js';

function attempt(overrides: Partial<Attempt>): Attempt {
  return {
    provider: 'groq',
    model: 'test-model',
    attempt: 1,
    outcome: 'OK',
    status: 200,
    latencyMs: 100,
    promptTokens: 1000,
    completionTokens: 200,
    finishReason: 'stop',
    ...overrides,
  };
}

describe('the call ledger', () => {
  it('holds attempts until a case is closed, then assigns them to that case', () => {
    const ledger = new CallLedger();
    const first = attempt({ latencyMs: 10 });
    const second = attempt({ latencyMs: 20, attempt: 2 });
    ledger.record(first);
    ledger.record(second);
    expect(ledger.unassigned()).toEqual([first, second]);
    ledger.closeCase('case-1');
    expect(ledger.unassigned()).toEqual([]);
    expect(ledger.cases()).toEqual([{ caseId: 'case-1', attempts: [first, second] }]);
  });

  it('keeps each case separate, in the order the cases were closed', () => {
    const ledger = new CallLedger();
    ledger.record(attempt({ latencyMs: 1 }));
    ledger.closeCase('a');
    ledger.record(attempt({ latencyMs: 2 }));
    ledger.record(attempt({ latencyMs: 3 }));
    ledger.closeCase('b');
    expect(ledger.cases().map((c) => [c.caseId, c.attempts.length])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });
});

describe('the cost of a call', () => {
  it('prices input and output tokens at the provider list price, per million tokens', () => {
    const price = Object.values(PROVIDERS).find((p) => p.id === 'groq')?.listPrice ?? null;
    if (price === null) throw new Error('groq has no list price');
    const expected = (1000 * price.input + 200 * price.output) / 1_000_000;
    expect(
      costOf(attempt({ provider: 'groq', promptTokens: 1000, completionTokens: 200 })),
    ).toBeCloseTo(expected, 12);
  });

  it('counts an unreported token count as zero', () => {
    expect(costOf(attempt({ promptTokens: null, completionTokens: null }))).toBe(0);
  });

  it('is unknown for a provider with no list price on record', () => {
    expect(costOf(attempt({ provider: 'no-such-provider' }))).toBeNull();
  });

  it('adds costs only when every one of them is known', () => {
    expect(sumOf([1, 2, 0.5])).toBeCloseTo(3.5, 12);
    expect(sumOf([])).toBe(0);
    expect(sumOf([1, null])).toBeNull();
  });
});

describe('the summary by provider', () => {
  it('counts successes and failures by class, and gives latency percentiles of the successes', () => {
    const rows = [
      attempt({ latencyMs: 100 }),
      attempt({ latencyMs: 300 }),
      attempt({ latencyMs: 200 }),
      attempt({ outcome: 'RATE_LIMIT', status: 429, latencyMs: 5 }),
      attempt({ outcome: 'RATE_LIMIT', status: 429, latencyMs: 5 }),
      attempt({ outcome: 'TIMEOUT', status: null, latencyMs: 9000 }),
    ];
    const [summary] = summariseByProvider(rows);
    expect(summary).toBeDefined();
    expect(summary?.attempts).toBe(6);
    expect(summary?.ok).toBe(3);
    expect([...(summary?.failuresByClass.entries() ?? [])]).toEqual([
      ['RATE_LIMIT', 2],
      ['TIMEOUT', 1],
    ]);
    expect(summary?.latencyMsMedian).toBe(200);
    expect(summary?.latencyMsP90).toBe(300);
    expect(summary?.promptTokens).toBe(6000);
    expect(summary?.completionTokens).toBe(1200);
    expect(summary?.costUsd).not.toBeNull();
  });

  it('gives one summary per provider, in name order, and no latency when a provider never succeeded', () => {
    const rows = [
      attempt({ provider: 'groq' }),
      attempt({ provider: 'gemini', outcome: 'SERVER', status: 503 }),
    ];
    const summaries = summariseByProvider(rows);
    expect(summaries.map((s) => s.provider)).toEqual(['gemini', 'groq']);
    const gemini = summaries.find((s) => s.provider === 'gemini');
    expect(gemini?.latencyMsMedian).toBeNull();
    expect(gemini?.latencyMsP90).toBeNull();
  });

  it('reports no cost for a provider it cannot price, and no summary for an empty run', () => {
    const [summary] = summariseByProvider([attempt({ provider: 'no-such-provider' })]);
    expect(summary?.costUsd).toBeNull();
    expect(summariseByProvider([])).toEqual([]);
  });
});
