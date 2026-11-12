import {
  DEFAULT_MATCH_TOLERANCE,
  editDistance,
  withinTolerance,
  type Tolerance,
} from '../../../../packages/shared/src/match-rules.js';
import {
  normaliseInvoiceNumber as normaliseNumber,
  obligationKey,
} from '../../../../packages/shared/src/node.js';

import { accountKey } from './match.js';

/**
 * Screens a matched invoice against the buyer's payment history for patterns a single-invoice match cannot see:
 * the same payable under a new file, a near-duplicate number, several invoices to one account in a short window,
 * and dates that cannot be right. Every hit is a HOLD for a person. Nothing here approves a payment.
 *
 * These are heuristics with stated thresholds (R3 sections 2c and 2d). They are not a measured detector: the
 * thresholds are policy values, and the labelled set in the tests shows only what the thresholds catch in that set.
 */

export interface ScreenCandidate {
  /** SHA-256 of the file. Used to exclude the candidate's own record from the history. */
  readonly fingerprint: string;
  readonly supplierId: string;
  readonly invoiceNumber: string;
  readonly amountMinor: number;
  /** The account the invoice prints, or null when none is printed. */
  readonly payeeAccountAsPrinted: string | null;
  /** The invoice date as printed, YYYY-MM-DD. */
  readonly invoiceDate: string;
}

export interface ScreenOptions {
  readonly now: Date;
  readonly tolerance?: Tolerance;
  /** Two invoices to one payee account within this many days count as one window. */
  readonly splitWindowDays?: number;
  /** A combined total above this, within the window, is held as a suspected split. Null turns the check off. */
  readonly splitThresholdMinor: number | null;
  /** Near-duplicate window for amount and date. */
  readonly nearDuplicateWindowDays?: number;
  /** An invoice dated more than this many days in the past is held. */
  readonly maxAgeDays?: number;
}

export const SCREEN_CODES = [
  'DUPLICATE_RECORD',
  'NEAR_DUPLICATE',
  'SPLIT_SUSPECTED',
  'INVOICE_FUTURE_DATED',
  'INVOICE_TOO_OLD',
  'INVOICE_DATE_INVALID',
] as const;
export type ScreenCode = (typeof SCREEN_CODES)[number];

export interface ScreenResult {
  readonly holds: readonly ScreenCode[];
}

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Days from one YYYY-MM-DD to another (b minus a). Returns NaN for a string that is not a real calendar date. */
export function daysBetween(a: string, b: string): number {
  if (!DATE_PATTERN.test(a) || !DATE_PATTERN.test(b)) return Number.NaN;
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return Number.NaN;
  if (new Date(left).toISOString().slice(0, 10) !== a) return Number.NaN;
  return Math.round((right - left) / DAY_MS);
}

function sortedHistory(history: readonly ScreenCandidate[]): readonly ScreenCandidate[] {
  // Sorted so the same history always gives the same holds in the same order (doctrine 5).
  return [...history].sort((x, y) =>
    `${x.fingerprint}|${x.invoiceNumber}`.localeCompare(`${y.fingerprint}|${y.invoiceNumber}`),
  );
}

/** Screens one candidate. The candidate's own fingerprint is ignored when it appears in the history. */
export function screenInvoice(
  candidate: ScreenCandidate,
  history: readonly ScreenCandidate[],
  options: ScreenOptions,
): ScreenResult {
  const tolerance = options.tolerance ?? DEFAULT_MATCH_TOLERANCE;
  const splitWindow = options.splitWindowDays ?? 14;
  const nearWindow = options.nearDuplicateWindowDays ?? 30;
  const maxAge = options.maxAgeDays ?? 365;
  const holds = new Set<ScreenCode>();

  const today = options.now.toISOString().slice(0, 10);
  const ageDays = daysBetween(candidate.invoiceDate, today);
  if (Number.isNaN(ageDays)) {
    holds.add('INVOICE_DATE_INVALID');
  } else {
    if (ageDays < -1) holds.add('INVOICE_FUTURE_DATED');
    if (ageDays > maxAge) holds.add('INVOICE_TOO_OLD');
  }

  const others = sortedHistory(history).filter(
    (item) => item.fingerprint !== candidate.fingerprint,
  );
  const candidateNumber = normaliseNumber(candidate.invoiceNumber);
  const candidateKey = obligationKey(candidate.supplierId, candidate.invoiceNumber);
  const candidateAccount = candidate.payeeAccountAsPrinted
    ? accountKey(candidate.payeeAccountAsPrinted)
    : null;

  let splitTotal = candidate.amountMinor;
  let splitCount = 0;

  for (const item of others) {
    const sameSupplier = item.supplierId === candidate.supplierId;
    const itemNumber = normaliseNumber(item.invoiceNumber);
    const itemKey = obligationKey(item.supplierId, item.invoiceNumber);
    const gap = daysBetween(item.invoiceDate, candidate.invoiceDate);
    const closeInDays = Number.isNaN(gap) ? Number.POSITIVE_INFINITY : Math.abs(gap);

    // The same payable under a different file, or the same number with other content.
    if (sameSupplier && itemKey === candidateKey) {
      holds.add('DUPLICATE_RECORD');
    }

    // A near-duplicate: the number differs by one character, the amount is within tolerance, and the dates are close.
    if (
      sameSupplier &&
      itemKey !== candidateKey &&
      candidateNumber.length >= 4 &&
      editDistance(itemNumber, candidateNumber) <= 1 &&
      withinTolerance(item.amountMinor, candidate.amountMinor, tolerance) &&
      closeInDays <= nearWindow
    ) {
      holds.add('NEAR_DUPLICATE');
    }

    // Split across days: the same normalised payee account, a close date, and a combined total over the threshold.
    if (
      candidateAccount !== null &&
      item.payeeAccountAsPrinted !== null &&
      accountKey(item.payeeAccountAsPrinted) === candidateAccount &&
      closeInDays <= splitWindow
    ) {
      splitTotal += item.amountMinor;
      splitCount += 1;
    }
  }

  if (
    options.splitThresholdMinor !== null &&
    splitCount > 0 &&
    splitTotal > options.splitThresholdMinor
  ) {
    holds.add('SPLIT_SUSPECTED');
  }

  return { holds: SCREEN_CODES.filter((code) => holds.has(code)) };
}
