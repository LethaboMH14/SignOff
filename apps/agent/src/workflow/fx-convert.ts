// Converts an invoice payable in rand into the USD minor units the Warden pays (RLUSD is treated as 1 USD).
// Invoices are in ZAR, but the ledger pays RLUSD. Paying the rand figure as if it were dollars would send
// about 16 times the owed amount, so the conversion is part of the proposal, at a live rate, or it does not happen.
import {
  parseRate,
  resolveUsdZarRate,
  type UsdZarRate,
} from '../../../../packages/shared/src/fx/index.js';

/** The conversion the proposal carries, with the rate and its source, so the log can name them. */
export interface UsdConversion {
  readonly currency: 'USD';
  /** USD minor units (cents), rounded half up. */
  readonly amountMinor: number;
  readonly rate: string;
  readonly rateDate: string;
  readonly source: string;
}

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxError';
  }
}

/** The exact conversion: usd cents = round_half_up(zar cents / rate), computed in integers. No floating point. */
export function zarMinorToUsdMinor(zarMinor: number, rate: UsdZarRate): number {
  if (!Number.isSafeInteger(zarMinor) || zarMinor < 0) {
    throw new FxError('the rand amount must be a non-negative whole number of cents');
  }
  if (rate.fallbackReason !== null) {
    // A fixture rate used after a failed live request is a stale default. A payment never uses one.
    throw new FxError(`the rate is not live (${rate.fallbackReason}); the payment is held`);
  }
  const { scaled } = parseRate(rate.rate);
  const scale = 10n ** 6n;
  // usd = zar / (scaled / 10^6) = zar * 10^6 / scaled; round half up with integer arithmetic.
  const numerator = BigInt(zarMinor) * scale;
  return Number((2n * numerator + scaled) / (2n * scaled));
}

/** Fetches the live USD/ZAR rate and converts one rand amount. Any failure is an FxError, never a guess. */
export async function convertZarLive(zarMinor: number): Promise<UsdConversion> {
  const rate = await resolveUsdZarRate({ mode: 'live' });
  return conversionOf(zarMinor, rate);
}

/** The conversion for a rate already in hand (used by the live path and by tests). */
export function conversionOf(zarMinor: number, rate: UsdZarRate): UsdConversion {
  return {
    currency: 'USD',
    amountMinor: zarMinorToUsdMinor(zarMinor, rate),
    rate: rate.rate,
    rateDate: rate.rateDate,
    source: rate.source,
  };
}
