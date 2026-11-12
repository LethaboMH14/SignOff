// Simulated RLUSD-to-rand payout quote for the receipt (D4). Pure: no network, no clock, no file reads.
// Every quote this module returns is labelled SIMULATED. It is a planning figure for the receipt,
// not a bank rate, not a settlement and not a promise that a rand payout will be made.

import { assertMinorUnits, formatMinor } from '../money/minor-units.js';

/** The label every quote carries. Anything shown to a person must keep it (rule R-3). */
export const SIMULATED_LABEL = 'SIMULATED' as const;

/** The stated assumption: RLUSD is treated as one US dollar. No market price for RLUSD is applied. */
export const RLUSD_ASSUMPTION = 'RLUSD is treated as 1 USD (no market price for RLUSD is applied).';

/** Rate digits after the decimal point. Fixed, so every rate is an exact integer at 10^-6. */
const RATE_DECIMALS = 6;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);
const DATE_TEXT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** True for a non-empty run of ASCII digits only. */
function isDigitRun(text: string): boolean {
  return /^[0-9]+$/.test(text);
}

/**
 * True for rate text such as "16.3957": at most four whole digits with no leading zero, and at most
 * six decimal places. Checked digit by digit, so no pattern can backtrack on hostile input.
 */
export function isRateText(text: string): boolean {
  const [whole = '', fraction, ...extra] = text.split('.');
  if (extra.length > 0 || whole.length === 0 || whole.length > 4) return false;
  if (!isDigitRun(whole) || (whole.length > 1 && whole.startsWith('0'))) return false;
  if (fraction === undefined) return true;
  return fraction.length <= RATE_DECIMALS && isDigitRun(fraction);
}

/** A dated USD-to-ZAR rate: how many rand one US dollar buys, and where the figure came from. */
export interface UsdZarRate {
  /** Rand per US dollar as plain decimal text, e.g. "16.3957". Never a float in the maths. */
  readonly rate: string;
  /** The date the rate applies to, YYYY-MM-DD, as the source reported it. */
  readonly rateDate: string;
  /** Who supplied the rate, in words a reader can check. */
  readonly source: string;
  /** Whether the figure came from the live API or from the committed fixture. */
  readonly sourceKind: 'live' | 'fixture';
  /** Why a live request was replaced by the fixture, or null when no fallback happened. */
  readonly fallbackReason: string | null;
}

export interface SimulatedZarQuote {
  readonly label: typeof SIMULATED_LABEL;
  /** The delivered RLUSD amount in minor units (cents). */
  readonly deliveredRlusdMinor: number;
  /** The rand payout in minor units (cents of a rand), rounded half up to the cent. */
  readonly zarMinor: number;
  /** The rand payout for people to read, e.g. "163.96". */
  readonly zarText: string;
  readonly rate: string;
  readonly rateDate: string;
  readonly source: string;
  readonly sourceKind: 'live' | 'fixture';
  readonly fallbackReason: string | null;
  readonly assumption: typeof RLUSD_ASSUMPTION;
}

/** A rate in exact integer form: rand per USD multiplied by 10^6. */
export interface ScaledRate {
  readonly scaled: bigint;
}

/**
 * Parses rate text such as "16.3957" into an exact integer scaled by 10^6. Rejects exponent notation,
 * signs, spaces, zero, and more than six decimal places: rounding a rate silently would change the
 * payout without anyone seeing it.
 */
export function parseRate(text: string): ScaledRate {
  if (!isRateText(text)) {
    throw new RangeError('rate must be plain decimal text with up to 6 decimal places');
  }
  const [whole = '', fraction = ''] = text.split('.');
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(RATE_DECIMALS, '0'));
  if (scaled <= 0n) {
    throw new RangeError('rate must be greater than zero');
  }
  return { scaled };
}

/**
 * Converts a delivered RLUSD amount into rand at a dated USD-to-ZAR rate.
 *
 * Arithmetic: RLUSD cents are treated as US cents, so the rand cents are cents x rate, and the
 * product is rounded half up to the cent. One RLUSD at 16.3957 gives 1639.57 rand cents, which
 * rounds to 1640 (R16.40).
 */
export function quoteRlusdPayoutInZar(
  deliveredRlusdMinor: number,
  rate: UsdZarRate,
): SimulatedZarQuote {
  assertMinorUnits(deliveredRlusdMinor);
  if (!DATE_TEXT.test(rate.rateDate)) {
    throw new RangeError('rate date must be YYYY-MM-DD');
  }
  const { scaled } = parseRate(rate.rate);

  // zar = round_half_up(cents x scaled / 10^6), computed in exact integers.
  const numerator = BigInt(deliveredRlusdMinor) * scaled;
  const zarMinor = Number((2n * numerator + RATE_SCALE) / (2n * RATE_SCALE));
  assertMinorUnits(zarMinor);

  return {
    label: SIMULATED_LABEL,
    deliveredRlusdMinor,
    zarMinor,
    zarText: formatMinor(zarMinor, 'ZAR'),
    rate: rate.rate,
    rateDate: rate.rateDate,
    source: rate.source,
    sourceKind: rate.sourceKind,
    fallbackReason: rate.fallbackReason,
    assumption: RLUSD_ASSUMPTION,
  };
}
