/**
 * Matching rules that both the agent and the Warden must apply the same way. Platform-neutral (no Node built-ins),
 * so each side imports the same functions and a shared table of cases proves that one input gives one verdict.
 *
 * Money is integer minor units throughout. A tolerance is the larger of an absolute allowance and a percentage
 * allowance, rounded down, which is the rule the Warden has always applied (apps/warden/src/checks.ts, R3 section 2a).
 */

export interface Tolerance {
  readonly absoluteMinor: number;
  readonly basisPoints: number;
}

/**
 * The default the agent uses when a run is not given a buyer policy. It equals the Warden's test and gate
 * configuration, so the two sides agree out of the box. A buyer must set the same value in both policy files; the
 * agent cannot read the Warden's file, so this is a stated limitation, not a verified sync.
 */
export const DEFAULT_MATCH_TOLERANCE: Tolerance = { absoluteMinor: 100, basisPoints: 100 };

/** The larger of the absolute allowance and the percentage allowance on the given amount, rounded down. */
export function toleranceMinor(amountMinor: number, tolerance: Tolerance): number {
  return Math.max(
    tolerance.absoluteMinor,
    Math.floor((amountMinor * tolerance.basisPoints) / 10_000),
  );
}

/** True when the actual amount is within tolerance of the expected amount, in either direction. */
export function withinTolerance(
  expectedMinor: number,
  actualMinor: number,
  tolerance: Tolerance,
): boolean {
  return Math.abs(actualMinor - expectedMinor) <= toleranceMinor(expectedMinor, tolerance);
}

/** True when the goods received cover the invoice, allowing the tolerance to be short. */
export function receiptCovers(
  invoiceMinor: number,
  receivedMinor: number,
  tolerance: Tolerance,
): boolean {
  return receivedMinor >= invoiceMinor - toleranceMinor(invoiceMinor, tolerance);
}

/**
 * Legal-form words that do not identify a supplier. Only the words are removed; the payee account still decides who
 * is paid (see the match module), so a name variant can select a candidate but never a payee.
 */
const LEGAL_FORMS =
  /\((pty|proprietary)\)|\b(pty|proprietary)\b|\b(ltd|limited|cc|inc|incorporated|llc|co)\b\.?/gi;

/**
 * A comparison key for a supplier's legal name: NFKC, lower case, legal-form words and punctuation removed, and
 * spaces collapsed. "Lumen Supplies (Pty) Ltd" and "LUMEN SUPPLIES PTY LTD" give the same key.
 */
export function supplierNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(LEGAL_FORMS, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Levenshtein edit distance on two strings, computed on code points. Used on normalised invoice numbers. */
export function editDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous: number[] = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left.at(i - 1) === right.at(j - 1) ? 0 : 1;
      current.push(
        Math.min(
          (current.at(j - 1) ?? 0) + 1,
          (previous.at(j) ?? 0) + 1,
          (previous.at(j - 1) ?? 0) + cost,
        ),
      );
    }
    previous = current;
  }
  return previous.at(right.length) ?? 0;
}
