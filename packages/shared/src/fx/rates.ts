// Where the USD-to-ZAR rate comes from. Fixture mode is the default and reads a committed capture of
// the Frankfurter API. Live mode asks the public Frankfurter API once. Any failure in live mode falls
// back to the fixture, and the fallback is recorded on the rate, so it is never silent.

import { z } from 'zod';

import { isRateText, type UsdZarRate } from './quote.js';
import fixtureCapture from './fixtures/frankfurter-usd-zar-2026-11-10.json' with { type: 'json' };

/** The public Frankfurter API (no key). Verified with one real request on 2026-11-12. */
export const FRANKFURTER_LATEST_URL =
  'https://api.frankfurter.dev/v1/latest?base=USD&symbols=ZAR' as const;

export const FX_SOURCE_LIVE =
  'Frankfurter API (frankfurter.dev, ECB reference rates), live request';
export const FX_SOURCE_FIXTURE =
  'Frankfurter API response captured 2026-11-12 (committed fixture, not a live request)';

export type FxMode = 'fixture' | 'live';

export interface ResolveRateOptions {
  /** Defaults to 'fixture'. Live mode is opt-in. */
  readonly mode?: FxMode;
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Live request time limit in milliseconds. Defaults to 5000. */
  readonly timeoutMs?: number;
}

/** The Frankfurter `/v1/latest` and `/v1/{date}` response for base USD, symbol ZAR. */
const FrankfurterResponse = z.object({
  amount: z.number(),
  base: z.literal('USD'),
  date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  rates: z.object({ ZAR: z.number().positive() }),
});

/**
 * Turns a parsed Frankfurter body into a rate. Throws if the shape, date or rate is not what the
 * module can use exactly.
 */
export function parseFrankfurterBody(
  body: unknown,
  origin: { readonly source: string; readonly sourceKind: 'live' | 'fixture' },
): UsdZarRate {
  const parsed = FrankfurterResponse.parse(body);
  const rate = String(parsed.rates.ZAR);
  if (!isRateText(rate)) {
    throw new Error('the ZAR rate has more than six decimal places or an unusual form');
  }
  return {
    rate,
    rateDate: parsed.date,
    source: origin.source,
    sourceKind: origin.sourceKind,
    fallbackReason: null,
  };
}

/** The committed fixture (a raw Frankfurter response), parsed through the same parser as live. */
export function fixtureUsdZarRate(): UsdZarRate {
  return parseFrankfurterBody(fixtureCapture, {
    source: FX_SOURCE_FIXTURE,
    sourceKind: 'fixture',
  });
}

/** Reads a live response with a time limit. Any failure is thrown with a plain reason. */
async function fetchLiveRate(fetchImpl: typeof fetch, timeoutMs: number): Promise<UsdZarRate> {
  const response = await fetchImpl(FRANKFURTER_LATEST_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  return parseFrankfurterBody(body, { source: FX_SOURCE_LIVE, sourceKind: 'live' });
}

/** Describes a thrown value in one plain sentence for the receipt. */
function reasonOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timed out';
  if (error instanceof z.ZodError) return 'unexpected response shape';
  if (error instanceof SyntaxError) return 'response was not JSON';
  if (error instanceof Error && error.message.startsWith('HTTP ')) return error.message;
  if (error instanceof Error && error.message.includes('rate')) return 'unusable ZAR rate';
  return 'network request failed';
}

/**
 * Resolves the USD-to-ZAR rate. Fixture mode returns the committed capture. Live mode tries the
 * Frankfurter API once and, on any failure, returns the fixture with `fallbackReason` set.
 */
export async function resolveUsdZarRate(options: ResolveRateOptions = {}): Promise<UsdZarRate> {
  if ((options.mode ?? 'fixture') === 'fixture') {
    return fixtureUsdZarRate();
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  try {
    return await fetchLiveRate(fetchImpl, timeoutMs);
  } catch (error: unknown) {
    const fallback = fixtureUsdZarRate();
    return {
      ...fallback,
      fallbackReason: `live request failed (${reasonOf(error)}); fixture used`,
      source: `${FX_SOURCE_FIXTURE}. FALLBACK: live Frankfurter request failed (${reasonOf(error)})`,
    };
  }
}
