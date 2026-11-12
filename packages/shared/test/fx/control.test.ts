import { describe, expect, it } from 'vitest';

import { resolveControlRate } from '../../src/fx/control.js';

const frankfurter = (rate: number) =>
  new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-11-12', rates: { ZAR: rate } }), { status: 200 });
const currencyApi = (zar: number) =>
  new Response(JSON.stringify({ date: '2026-11-12', usd: { zar } }), { status: 200 });

/** A stub that answers by URL: Frankfurter gets `first`, currency-api gets `second` (a Response or a thrown error). */
function stub(first: () => Response | Error, second: () => Response | Error): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const answer = url.includes('frankfurter') ? first() : second();
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
}

describe('control-path USD/ZAR rate', () => {
  it('returns the live Frankfurter rate when currency-api agrees within the limit', async () => {
    const result = await resolveControlRate({ fetchImpl: stub(() => frankfurter(16.6), () => currencyApi(16.51)) });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.rate).toMatchObject({ rate: '16.6', rateDate: '2026-11-12', sourceKind: 'live' });
    expect(result.crossCheck.rate).toBe(16.51);
    expect(result.divergence).toBeCloseTo(0.0054, 3);
  });

  it('holds with "source unavailable" when Frankfurter is down; never a fixture', async () => {
    const result = await resolveControlRate({
      fetchImpl: stub(() => new Error('network'), () => currencyApi(16.5)),
    });
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toMatch(/fixture/i);
  });

  it('holds when currency-api is down or returns a bad shape', async () => {
    expect(
      await resolveControlRate({ fetchImpl: stub(() => frankfurter(16.7), () => new Error('down')) }),
    ).toMatchObject({ status: 'unavailable' });
    expect(
      await resolveControlRate({
        fetchImpl: stub(() => frankfurter(16.7), () => new Response('{"usd":{}}', { status: 200 })),
      }),
    ).toMatchObject({ status: 'unavailable' });
  });

  it('holds as DIVERGED when the sources differ by more than 1%', async () => {
    const result = await resolveControlRate({ fetchImpl: stub(() => frankfurter(16.7), () => currencyApi(16.0)) });
    expect(result).toMatchObject({ status: 'diverged' });
  });
});
