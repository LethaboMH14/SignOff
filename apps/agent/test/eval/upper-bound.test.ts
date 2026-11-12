import { describe, expect, it } from 'vitest';

import { clopperPearsonUpper } from '../../src/eval/upper-bound.js';

describe('exact one-sided upper bound on an error rate', () => {
  it('gives the closed form for zero errors: 1 - alpha^(1/n)', () => {
    expect(clopperPearsonUpper(0, 100)).toBeCloseTo(1 - 0.05 ** (1 / 100), 6);
    expect(clopperPearsonUpper(0, 60)).toBeCloseTo(1 - 0.05 ** (1 / 60), 6);
    expect(clopperPearsonUpper(0, 100)).toBeCloseTo(0.0295, 4);
  });

  it('is larger with more errors on the same number of trials', () => {
    const none = clopperPearsonUpper(0, 100);
    const one = clopperPearsonUpper(1, 100);
    const three = clopperPearsonUpper(3, 100);
    expect(one).toBeGreaterThan(none);
    expect(three).toBeGreaterThan(one);
  });

  it('is 1 when every trial is an error', () => {
    expect(clopperPearsonUpper(5, 5)).toBe(1);
  });

  it('shrinks as the trials grow with no errors', () => {
    expect(clopperPearsonUpper(0, 300)).toBeLessThan(clopperPearsonUpper(0, 100));
  });

  it('refuses inputs that cannot be counts', () => {
    expect(() => clopperPearsonUpper(-1, 10)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(11, 10)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(0, 0)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(0.5, 10)).toThrow(RangeError);
  });
});
