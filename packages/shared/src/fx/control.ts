/**
 * The FX rate for a payment decision (Lane E item 4). Control-path rule: NEVER a fixture. The rate comes from the live
 * Frankfurter API and is cross-checked against the live currency-api (fawazahmed0). If either source is down, or the two
 * disagree by more than the divergence limit, the result is UNAVAILABLE or DIVERGED and the decision is held. Nothing
 * here guesses a rate.
 */
import { z } from 'zod';

import { FRANKFURTER_LATEST_URL, parseFrankfurterBody } from './rates.js';
import { type UsdZarRate } from './quote.js';

/** currency-api, read from jsDelivr (no key). The date segment is replaced by the caller's date, or `latest`. */
export const CURRENCY_API_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json' as const;

/** Relative difference allowed between the two sources before the rate is treated as diverged. Proposed: 1%. */
export const DEFAULT_DIVERGENCE_LIMIT = 0.01;

const CurrencyApiBody = z.object({
  date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  usd: z.object({ zar: z.number().positive() }),
});

export type ControlRate =
  | {
      readonly status: 'ok';
      readonly rate: UsdZarRate;
      /** The second source's rate and date, for the receipt. */
      readonly crossCheck: { readonly source: string; readonly rate: number; readonly date: string };
      /** |a - b| / a, as a fraction. */
      readonly divergence: number;
    }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'diverged'; readonly reason: string; readonly divergence: number };

export interface ControlRateOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly divergenceLimit?: number;
}

const CURRENCY_API_SOURCE = 'currency-api (fawazahmed0, jsDelivr), live request';

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }
  return response.json();
}

/** Resolves the control-path USD/ZAR rate. Live only; any failure is a hold, never a fixture. */
export async function resolveControlRate(options: ControlRateOptions = {}): Promise<ControlRate> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const limit = options.divergenceLimit ?? DEFAULT_DIVERGENCE_LIMIT;

  let primary: UsdZarRate;
  try {
    const body = await getJson(fetchImpl, FRANKFURTER_LATEST_URL, timeoutMs);
    primary = parseFrankfurterBody(body, { source: 'Frankfurter API (frankfurter.dev, ECB), live', sourceKind: 'live' });
  } catch {
    return { status: 'unavailable', reason: 'source unavailable: Frankfurter did not return a usable rate' };
  }

  let secondRate: number;
  let secondDate: string;
  try {
    const parsed = CurrencyApiBody.parse(await getJson(fetchImpl, CURRENCY_API_URL, timeoutMs));
    secondRate = parsed.usd.zar;
    secondDate = parsed.date;
  } catch {
    return { status: 'unavailable', reason: 'source unavailable: currency-api did not return a usable rate' };
  }

  const first = Number(primary.rate);
  const divergence = Math.abs(first - secondRate) / first;
  if (divergence > limit) {
    return {
      status: 'diverged',
      reason: `the two sources disagree by more than ${String(limit * 100)}%; the decision is held`,
      divergence,
    };
  }
  return {
    status: 'ok',
    rate: primary,
    crossCheck: { source: CURRENCY_API_SOURCE, rate: secondRate, date: secondDate },
    divergence,
  };
}
