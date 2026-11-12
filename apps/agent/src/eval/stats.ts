/**
 * Statistics for the swarm (pipeline) against the single-prompt baseline. Every number is computed here, in code.
 *
 * Doctrine gates for "A beats B": a Mann-Whitney test with p < 0.05, AND a bootstrap 95% interval for the mean
 * difference that excludes zero. Cliff's delta is reported with its magnitude but is not a gate. If either gate
 * fails, the verdict is "no significant difference", whatever the point estimate says.
 *
 * Limitation: the two sides score the same cases, so the scores are paired. Mann-Whitney treats them as independent,
 * which is the doctrine's named test and is conservative for paired data only when the pairing is weak. The bootstrap
 * resamples cases, so it respects the pairing. Both are reported.
 *
 * The bootstrap is seeded, so the same scores always give the same interval (determinism is correctness).
 */

export const BOOTSTRAP_ITERATIONS = 10_000;
export const BOOTSTRAP_SEED = 20_261_112;
export const ALPHA = 0.05;

/** A small seeded generator (mulberry32). It is fixed, so the bootstrap is repeatable. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function meanOf(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The bootstrap 95% interval (percentile method) for the mean of a - b over paired cases. Cases are resampled with
 * replacement, and the same case index is used on both sides, so the pairing is kept.
 */
export function bootstrapMeanDiff(
  a: readonly number[],
  b: readonly number[],
  iterations = BOOTSTRAP_ITERATIONS,
  seed = BOOTSTRAP_SEED,
): { readonly mean: number; readonly low: number; readonly high: number } {
  if (a.length !== b.length) {
    throw new RangeError('paired scores must have the same length');
  }
  const diffs = a.map((value, index) => value - (b.at(index) ?? 0));
  const n = diffs.length;
  if (n === 0) {
    return { mean: 0, low: 0, high: 0 };
  }
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let round = 0; round < iterations; round += 1) {
    let sum = 0;
    for (let draw = 0; draw < n; draw += 1) {
      sum += diffs.at(Math.floor(random() * n)) ?? 0;
    }
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const at = (q: number): number =>
    means.at(Math.min(means.length - 1, Math.floor(q * means.length))) ?? 0;
  return { mean: meanOf(diffs), low: at(0.025), high: at(0.975) };
}

/** The standard normal cumulative distribution (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Above this many label arrangements the exact test is replaced by the normal approximation. */
const EXACT_LIMIT = 200_000;

/** The number of ways to choose n1 of total positions, capped so the count stays cheap to compare. */
export function exactPermutationCount(total: number, n1: number): number {
  let count = 1;
  for (let step = 1; step <= n1; step += 1) {
    count = (count * (total - n1 + step)) / step;
    if (count > EXACT_LIMIT) {
      return EXACT_LIMIT + 1;
    }
  }
  return Math.round(count);
}

/**
 * The exact two-sided permutation p-value for the rank sum of the first sample: the share of every way of labelling
 * the pooled scores whose rank sum is at least as far from its expectation as the observed one.
 */
export function exactTwoSidedP(midranks: readonly number[], n1: number, observed: number): number {
  const total = midranks.length;
  const all = midranks.reduce((sum, rank) => sum + rank, 0);
  const expected = (n1 * all) / total;
  const distance = Math.abs(observed - expected);
  let extreme = 0;
  let arrangements = 0;
  const choose = (start: number, picked: number, sum: number): void => {
    if (picked === n1) {
      arrangements += 1;
      if (Math.abs(sum - expected) >= distance - 1e-9) {
        extreme += 1;
      }
      return;
    }
    for (let index = start; index <= total - (n1 - picked); index += 1) {
      choose(index + 1, picked + 1, sum + (midranks.at(index) ?? 0));
    }
  };
  choose(0, 0, 0);
  return arrangements === 0 ? 1 : Math.min(1, extreme / arrangements);
}

/**
 * The two-sided Mann-Whitney U test with midranks for ties. Small samples use the exact permutation distribution;
 * larger ones use the normal approximation with the tie correction in the variance. Returns the p-value. When every
 * score is tied, there is no difference to find and p is 1.
 */
export function mannWhitneyP(a: readonly number[], b: readonly number[]): number {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) {
    return 1;
  }
  const pooled = [
    ...a.map((value) => ({ value, side: 0 })),
    ...b.map((value) => ({ value, side: 1 })),
  ];
  pooled.sort((x, y) => x.value - y.value);
  const total = pooled.length;
  let rankSumA = 0;
  let tieTerm = 0;
  let index = 0;
  while (index < total) {
    let end = index;
    while (end + 1 < total && pooled.at(end + 1)?.value === pooled.at(index)?.value) {
      end += 1;
    }
    const size = end - index + 1;
    const midrank = (index + end + 2) / 2;
    for (let position = index; position <= end; position += 1) {
      if (pooled.at(position)?.side === 0) {
        rankSumA += midrank;
      }
    }
    tieTerm += size ** 3 - size;
    index = end + 1;
  }
  const midranks = pooled.map((item, position) => {
    // Recompute each element's midrank in pooled order, so the exact test can use the same ranks.
    let start = position;
    while (start > 0 && pooled.at(start - 1)?.value === item.value) start -= 1;
    let end = position;
    while (end + 1 < total && pooled.at(end + 1)?.value === item.value) end += 1;
    return (start + end + 2) / 2;
  });
  if (exactPermutationCount(total, n1) <= EXACT_LIMIT) {
    return exactTwoSidedP(midranks, n1, rankSumA);
  }
  const u = rankSumA - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  const variance = ((n1 * n2) / 12) * (total + 1 - tieTerm / (total * (total - 1)));
  if (!(variance > 0)) {
    return 1;
  }
  // Continuity correction of 0.5 towards the mean.
  const correction = u > mean ? -0.5 : u < mean ? 0.5 : 0;
  const z = (u - mean + correction) / Math.sqrt(variance);
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/** Cliff's delta: the share of pairs where a beats b, minus the share where b beats a. Ranges from -1 to 1. */
export function cliffsDelta(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  let greater = 0;
  let less = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) greater += 1;
      else if (x < y) less += 1;
    }
  }
  return (greater - less) / (a.length * b.length);
}

/** The usual reading of Cliff's delta (Romano et al. 2006). */
export function deltaMagnitude(delta: number): 'negligible' | 'small' | 'medium' | 'large' {
  const size = Math.abs(delta);
  if (size < 0.147) return 'negligible';
  if (size < 0.33) return 'small';
  if (size < 0.474) return 'medium';
  return 'large';
}

export type Verdict = 'pipeline better' | 'baseline better' | 'no significant difference';

export interface Comparison {
  readonly measure: string;
  readonly n: number;
  readonly pipelineMean: number;
  readonly baselineMean: number;
  /** Pipeline minus baseline, on the paired cases. */
  readonly meanDifference: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly pValue: number;
  readonly delta: number;
  readonly magnitude: ReturnType<typeof deltaMagnitude>;
  readonly gateMannWhitney: boolean;
  readonly gateInterval: boolean;
  readonly verdict: Verdict;
}

/** Compares the pipeline with the baseline on one measure. A verdict of "better" needs both gates to pass. */
export function compareSides(
  measure: string,
  pipeline: readonly number[],
  baseline: readonly number[],
): Comparison {
  const interval = bootstrapMeanDiff(pipeline, baseline);
  const pValue = mannWhitneyP(pipeline, baseline);
  const delta = cliffsDelta(pipeline, baseline);
  const gateMannWhitney = pValue < ALPHA;
  const gateInterval = interval.low > 0 || interval.high < 0;
  let verdict: Verdict = 'no significant difference';
  if (gateMannWhitney && gateInterval) {
    verdict = interval.mean > 0 ? 'pipeline better' : 'baseline better';
  }
  return {
    measure,
    n: pipeline.length,
    pipelineMean: meanOf(pipeline),
    baselineMean: meanOf(baseline),
    meanDifference: interval.mean,
    ciLow: interval.low,
    ciHigh: interval.high,
    pValue,
    delta,
    magnitude: deltaMagnitude(delta),
    gateMannWhitney,
    gateInterval,
    verdict,
  };
}
