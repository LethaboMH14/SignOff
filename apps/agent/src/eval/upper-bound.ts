/**
 * The exact one-sided Clopper-Pearson upper bound on an error rate: after k errors in n trials, the largest true rate
 * still consistent with the data at the stated confidence. Computed here, in code, from the binomial distribution
 * (doctrine 2: the code does the arithmetic). The bound is an upper limit on the rate, never a point estimate.
 */

/** P(X <= k) for X ~ Binomial(n, p), summed in log space. */
function binomialCdf(k: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  let logChoose = 0; // log C(n, i), built up term by term
  let total = 0;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i);
    total += Math.exp(logChoose + i * logP + (n - i) * logQ);
  }
  return Math.min(1, total);
}

/**
 * The one-sided upper confidence limit on the error rate, at confidence 1 - alpha. For example, zero errors in 100
 * trials at alpha 0.05 gives 1 - 0.05^(1/100), about 0.0295.
 */
export function clopperPearsonUpper(errors: number, trials: number, alpha = 0.05): number {
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new RangeError('the number of trials must be a positive whole number');
  }
  if (!Number.isInteger(errors) || errors < 0 || errors > trials) {
    throw new RangeError('the number of errors must be a whole number from 0 to the trials');
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new RangeError('alpha must be between 0 and 1');
  }
  if (errors === trials) return 1;
  // binomialCdf(errors, n, p) falls as p rises; find the p where it equals alpha.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    if (binomialCdf(errors, trials, mid) > alpha) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}
