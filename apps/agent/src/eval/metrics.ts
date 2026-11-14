/**
 * Counts, rates and intervals for the evaluation. A rate is reported with its numerator, its denominator and a 95%
 * Wilson score interval, because a small sample can look like proof when it is not. Zero false approvals in thirty
 * cases still leaves a wide interval, and the report shows it.
 */

const Z_95 = 1.959963984540054;

export interface Rate {
  readonly count: number;
  readonly n: number;
  /** The point estimate, or null when the denominator is zero. */
  readonly rate: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

/** The Wilson score interval for a proportion. It behaves sensibly at zero and at one, unlike the normal interval. */
export function wilsonInterval(
  count: number,
  n: number,
  z = Z_95,
): { readonly low: number; readonly high: number } {
  if (n <= 0) {
    return { low: 0, high: 1 };
  }
  const p = count / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

export function rateOf(count: number, n: number): Rate {
  if (n <= 0) {
    return { count, n, rate: null, low: null, high: null };
  }
  const interval = wilsonInterval(count, n);
  return { count, n, rate: count / n, low: interval.low, high: interval.high };
}

/** A rate as "k/n = p% (low to high)", for the report. */
export function describeRate(rate: Rate): string {
  if (rate.rate === null || rate.low === null || rate.high === null) {
    return `${String(rate.count)}/${String(rate.n)} (no cases)`;
  }
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  return `${String(rate.count)}/${String(rate.n)} = ${pct(rate.rate)} (95% CI ${pct(rate.low)} to ${pct(rate.high)})`;
}
