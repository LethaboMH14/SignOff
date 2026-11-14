import { describe, expect, it } from 'vitest';

import {
  bootstrapMeanDiff,
  cliffsDelta,
  compareSides,
  deltaMagnitude,
  mannWhitneyP,
  normalCdf,
  seededRandom,
} from '../../src/eval/stats.js';

describe('normalCdf', () => {
  it('matches the standard normal at known points', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 4);
  });
});

describe('cliffsDelta', () => {
  it('is 1, -1 and 0 for complete dominance and for equal samples', () => {
    expect(cliffsDelta([1, 1], [0, 0])).toBe(1);
    expect(cliffsDelta([0, 0], [1, 1])).toBe(-1);
    expect(cliffsDelta([0.5, 0.5], [0.5, 0.5])).toBe(0);
  });

  it('counts each pair once, so a partial overlap gives the exact share', () => {
    // Pairs: 2>1, 2>0, 0<1, 0=0 -> greater 2, less 1, out of 4 pairs -> 0.25
    expect(cliffsDelta([2, 0], [1, 0])).toBeCloseTo(0.25, 10);
  });

  it('labels magnitudes with the usual thresholds', () => {
    expect(deltaMagnitude(0.1)).toBe('negligible');
    expect(deltaMagnitude(-0.2)).toBe('small');
    expect(deltaMagnitude(0.4)).toBe('medium');
    expect(deltaMagnitude(0.9)).toBe('large');
  });
});

describe('mannWhitneyP', () => {
  it('finds no difference when every score is tied', () => {
    expect(mannWhitneyP([1, 1, 1], [1, 1, 1])).toBe(1);
  });

  it('finds a clear difference for two separated samples of 30', () => {
    const high = Array.from({ length: 30 }, () => 1);
    const low = Array.from({ length: 30 }, () => 0);
    expect(mannWhitneyP(high, low)).toBeLessThan(0.001);
  });

  it('uses the exact permutation p for small samples: 3 against 3 separated gives 0.1, not 0.05', () => {
    expect(mannWhitneyP([1, 1, 1], [0, 0, 0])).toBeCloseTo(0.1, 10);
  });

  it('is symmetric in its two samples', () => {
    const a = [0.2, 0.4, 0.9, 0.7, 0.1];
    const b = [0.5, 0.3, 0.6, 0.8, 0.95, 0.05];
    expect(mannWhitneyP(a, b)).toBeCloseTo(mannWhitneyP(b, a), 10);
  });
});

describe('bootstrapMeanDiff', () => {
  it('is repeatable with a fixed seed', () => {
    const a = [1, 0, 1, 1, 0, 1, 0, 1];
    const b = [0, 0, 1, 0, 0, 1, 0, 0];
    expect(bootstrapMeanDiff(a, b, 500, 7)).toEqual(bootstrapMeanDiff(a, b, 500, 7));
  });

  it('gives a zero-width interval at the mean when the paired difference is constant', () => {
    const result = bootstrapMeanDiff([1, 1, 1, 1], [0, 0, 0, 0], 200, 1);
    expect(result).toEqual({ mean: 1, low: 1, high: 1 });
  });

  it('brackets the mean difference', () => {
    const a = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1];
    const b = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0];
    const result = bootstrapMeanDiff(a, b, 1000, 3);
    expect(result.low).toBeLessThanOrEqual(result.mean);
    expect(result.high).toBeGreaterThanOrEqual(result.mean);
  });

  it('refuses unpaired scores', () => {
    expect(() => bootstrapMeanDiff([1, 0], [1])).toThrow(RangeError);
  });
});

describe('seededRandom', () => {
  it('gives the same sequence for the same seed, in [0, 1)', () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    const values = Array.from({ length: 5 }, () => first());
    expect(values).toEqual(Array.from({ length: 5 }, () => second()));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('compareSides', () => {
  it('says "no significant difference" when the sides are the same', () => {
    const same = Array.from({ length: 30 }, (_, index) => (index % 3 === 0 ? 1 : 0));
    const result = compareSides('same', same, same);
    expect(result.verdict).toBe('no significant difference');
    expect(result.gateMannWhitney).toBe(false);
    expect(result.gateInterval).toBe(false);
  });

  it('says the pipeline is better only when both gates pass', () => {
    const pipeline = Array.from({ length: 40 }, () => 1);
    const baseline = Array.from({ length: 40 }, (_, index) => (index < 10 ? 1 : 0));
    const result = compareSides('better', pipeline, baseline);
    expect(result.gateMannWhitney).toBe(true);
    expect(result.gateInterval).toBe(true);
    expect(result.verdict).toBe('pipeline better');
    expect(result.delta).toBeGreaterThan(0);
  });

  it('reports a small sample as not significant, even with a large point difference', () => {
    const result = compareSides('small', [1, 1, 1], [0, 0, 0]);
    expect(result.meanDifference).toBe(1);
    expect(result.verdict).toBe('no significant difference');
  });
});
