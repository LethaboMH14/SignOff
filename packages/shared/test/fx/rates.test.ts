import { describe, expect, it } from 'vitest';

import {
  FRANKFURTER_LATEST_URL,
  FX_SOURCE_FIXTURE,
  FX_SOURCE_LIVE,
  fixtureUsdZarRate,
  resolveUsdZarRate,
} from '../../src/fx/rates.js';
import { fetchStub, hangingFetch, jsonResponse } from '../helpers/fetch-stub.js';

const liveBody = {
  amount: 1,
  base: 'USD',
  date: '2026-11-11',
  rates: { ZAR: 16.5639 },
};

describe('fixture rate', () => {
  it('is the committed Frankfurter capture for 2026-11-10 at 16.3957 ZAR per USD', () => {
    expect(fixtureUsdZarRate()).toEqual({
      rate: '16.3957',
      rateDate: '2026-11-10',
      source: FX_SOURCE_FIXTURE,
      sourceKind: 'fixture',
      fallbackReason: null,
    });
  });

  it('is the default, and makes no network request', async () => {
    const stub = fetchStub(() => Promise.resolve(jsonResponse(liveBody)));
    const rate = await resolveUsdZarRate({ fetchImpl: stub.fetch });
    expect(rate.sourceKind).toBe('fixture');
    expect(rate.rate).toBe('16.3957');
    expect(rate.fallbackReason).toBeNull();
    expect(stub.calls).toEqual([]);
  });
});

describe('live rate', () => {
  it('reads the Frankfurter latest endpoint for USD to ZAR and labels the source live', async () => {
    const stub = fetchStub(() => Promise.resolve(jsonResponse(liveBody)));
    const rate = await resolveUsdZarRate({ mode: 'live', fetchImpl: stub.fetch });
    expect(stub.calls).toEqual([FRANKFURTER_LATEST_URL]);
    expect(rate).toEqual({
      rate: '16.5639',
      rateDate: '2026-11-11',
      source: FX_SOURCE_LIVE,
      sourceKind: 'live',
      fallbackReason: null,
    });
  });

  it.each([
    [
      'a network error',
      () => Promise.reject(new TypeError('fetch failed')),
      'network request failed',
    ],
    ['an HTTP error', () => Promise.resolve(jsonResponse({}, 503)), 'HTTP 503'],
    [
      'a body that is not JSON',
      () => Promise.resolve(new Response('not json', { status: 200 })),
      'response was not JSON',
    ],
    [
      'an unexpected shape',
      () => Promise.resolve(jsonResponse({ ...liveBody, base: 'EUR' })),
      'unexpected response shape',
    ],
    [
      'a rate with more than six decimal places',
      () => Promise.resolve(jsonResponse({ ...liveBody, rates: { ZAR: 16.12345678 } })),
      'unusable ZAR rate',
    ],
  ])('falls back to the fixture, labelled, on %s', async (_label, respond, reason) => {
    const stub = fetchStub(respond);
    const rate = await resolveUsdZarRate({ mode: 'live', fetchImpl: stub.fetch });
    expect(rate.sourceKind).toBe('fixture');
    expect(rate.rate).toBe('16.3957');
    expect(rate.rateDate).toBe('2026-11-10');
    expect(rate.fallbackReason).toBe(`live request failed (${reason}); fixture used`);
    expect(rate.source).toContain('FALLBACK');
    expect(rate.source).toContain(reason);
  });

  it('falls back when the request times out, and says so', async () => {
    const rate = await resolveUsdZarRate({
      mode: 'live',
      fetchImpl: hangingFetch(),
      timeoutMs: 1,
    });
    expect(rate.sourceKind).toBe('fixture');
    expect(rate.fallbackReason).toBe('live request failed (timed out); fixture used');
  });
});
