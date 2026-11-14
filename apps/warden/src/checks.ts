import type { WardenReasonCode } from '../../../packages/shared/src/schemas/index.js';

import { sha256Hex } from './canonical.js';
import type { GoodsReceiptRecord, InvoiceRecord, PurchaseOrderRecord } from './evidence.js';
import type { PreSigningFacts } from './ledger-read.js';
import { isUnresolved, type AttemptState, type LimitsState } from './state.js';
import { compareDecimal, normaliseDecimal } from '../../../packages/xrpl/src/amounts.js';
import {
  receiptCovers,
  withinTolerance,
  type Tolerance,
} from '../../../packages/shared/src/match-rules.js';

/**
 * The rules, one function each. Every function returns null when the rule passes, or the verdict that the
 * Warden must give. They are pure, so each rule is tested on its own, and the service only sequences them.
 */

export interface Verdict {
  readonly decision: 'HOLD' | 'REFUSE';
  readonly code: WardenReasonCode;
  readonly message: string;
}

/** HOLD waits for evidence, a limit change or a person. It never signs. */
export function hold(code: WardenReasonCode, message: string): Verdict {
  return { decision: 'HOLD', code, message };
}

/** REFUSE stops the proposal. Nothing retries it on its own. */
export function refuse(code: WardenReasonCode, message: string): Verdict {
  return { decision: 'REFUSE', code, message };
}

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The calendar day in South Africa (UTC+2, no daylight saving), as YYYY-MM-DD. Daily limits reset on it. */
export function sastDay(at: Date): string {
  return new Date(at.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The identity the Warden reserves against. It binds the buyer's scope to the normalised supplier and invoice
 * identity, so the same invoice under another buyer is a different payable.
 */
export function scopedKeyOf(buyerScope: string, obligationKey: string): string {
  return sha256Hex(`${buyerScope}\n${obligationKey}`);
}

/** The tolerance rule lives in shared code, so the agent and the Warden give the same verdict on the same input. */
export { toleranceMinor, type Tolerance } from '../../../packages/shared/src/match-rules.js';

/** Money already counted against a limit on a day: paid attempts and attempts still in flight. */
export function dailyUsage(
  attempts: Iterable<AttemptState>,
  day: string,
  supplierId: string | null,
): number {
  let total = 0;
  for (const attempt of attempts) {
    const counts = attempt.status === 'paid' || isUnresolved(attempt.status);
    const sameSupplier = supplierId === null || attempt.supplierId === supplierId;
    if (counts && sameSupplier && sastDay(new Date(attempt.createdAt)) === day) {
      total += attempt.amountMinor;
    }
  }
  return total;
}

/** The three-way match: invoice against purchase order, and goods received against the invoice. */
export function matchVerdict(input: {
  readonly supplierId: string;
  readonly invoice: InvoiceRecord;
  readonly purchaseOrder: PurchaseOrderRecord | undefined;
  readonly receipt: GoodsReceiptRecord | undefined;
  readonly tolerance: Tolerance;
}): Verdict | null {
  const { invoice, purchaseOrder, receipt, tolerance } = input;
  if (invoice.purchaseOrderId === null) {
    return hold('MISSING_EVIDENCE', 'the invoice names no purchase order');
  }
  if (purchaseOrder === undefined) {
    return hold('MISSING_EVIDENCE', 'the purchase order is not in the evidence register');
  }
  if (purchaseOrder.supplierId !== input.supplierId) {
    return refuse('INVARIANT_FAILED', 'the purchase order belongs to another supplier');
  }
  if (!withinTolerance(purchaseOrder.amountMinor, invoice.amountMinor, tolerance)) {
    return hold(
      'AMOUNT_MISMATCH',
      'the invoice does not match the purchase order within tolerance',
    );
  }
  if (receipt === undefined) {
    return hold('MISSING_EVIDENCE', 'no goods receipt is recorded for the purchase order');
  }
  if (!receiptCovers(invoice.amountMinor, receipt.receivedMinor, tolerance)) {
    return hold('AMOUNT_MISMATCH', 'the goods received do not cover the invoice within tolerance');
  }
  return null;
}

/** Per-payment, per-supplier and daily limits. Each is read from the current limits at decision time. */
export function limitVerdict(input: {
  readonly limits: LimitsState;
  readonly amountMinor: number;
  readonly supplierToday: number;
  readonly totalToday: number;
}): Verdict | null {
  const { limits, amountMinor } = input;
  if (amountMinor > limits.perPaymentMinor) {
    return hold('OVER_LIMIT', 'the amount is above the per-payment limit');
  }
  if (input.supplierToday + amountMinor > limits.supplierDailyMinor) {
    return hold('OVER_LIMIT', 'the supplier daily limit would be exceeded');
  }
  if (input.totalToday + amountMinor > limits.dailyTotalMinor) {
    return hold('OVER_LIMIT', 'the daily limit would be exceeded');
  }
  return null;
}

/** Exact decimal trust-line capacity check; never use floating point for a money comparison. */
function exceedsReceivingLimit(balance: string, amount: string, limit: string): boolean {
  const parts = [balance, amount, limit].map((value) => normaliseDecimal(value).split('.'));
  const scale = Math.max(...parts.map((part) => (part[1] ?? '').length));
  const scaled = (part: string[]): bigint =>
    BigInt((part[0] ?? '0') + (part[1] ?? '').padEnd(scale, '0'));
  const [current, incoming, maximum] = parts;
  if (current === undefined || incoming === undefined || maximum === undefined) {
    throw new Error('the receiving trust-line amount is missing');
  }
  return scaled(current) + scaled(incoming) > scaled(maximum);
}

/** The ledger facts read just before signing, checked against the amount. Any surprise holds the payment. */
export function preSigningVerdict(facts: PreSigningFacts, amount: string): Verdict | null {
  if (!facts.spendingExists) {
    return hold('INVARIANT_FAILED', 'the spending account is not on the ledger');
  }
  if (!facts.masterDisabled || facts.regularKeyPresent || !facts.signerListMatches) {
    return hold(
      'SIGNER_CHANGE_NOT_APPROVED',
      'the spending account signers differ from the approved set',
    );
  }
  if (facts.issuerGlobalFreeze) {
    return hold('ACCOUNT_FROZEN', 'the issuer has frozen the asset');
  }
  if (facts.issuerRequiresAuth) {
    return hold(
      'INVARIANT_FAILED',
      'the issuer requires trust-line authorization, which is not performed',
    );
  }
  if (facts.spendingLine === null) {
    return hold('INVARIANT_FAILED', 'the spending account does not hold the asset');
  }
  if (facts.spendingLine.frozenByIssuer || facts.spendingLine.frozenByHolder) {
    return hold('ACCOUNT_FROZEN', 'the spending account trust line is frozen');
  }
  if (compareDecimal(facts.spendingLine.balance, amount) < 0) {
    return hold('INVARIANT_FAILED', 'the spendable balance is below the amount');
  }
  if (!facts.destinationExists) {
    return hold('INVARIANT_FAILED', 'the payee account is not on the ledger');
  }
  if (facts.destinationRequiresAuth) {
    return hold(
      'INVARIANT_FAILED',
      'the payee requires trust-line authorization, which is not performed',
    );
  }
  if (facts.destinationRequiresDestTag && facts.enrolledDestinationTag === null) {
    return hold('INVARIANT_FAILED', 'the payee requires a destination tag that is not enrolled');
  }
  if (facts.destinationLine === null) {
    return hold('INVARIANT_FAILED', 'the payee cannot hold the asset');
  }
  if (facts.destinationLine.frozenByIssuer || facts.destinationLine.frozenByHolder) {
    return hold('ACCOUNT_FROZEN', 'the payee trust line is frozen');
  }
  try {
    if (exceedsReceivingLimit(facts.destinationLine.balance, amount, facts.destinationLine.limit)) {
      return hold('RECEIVING_CAPACITY', 'the payee trust line has insufficient receiving capacity');
    }
  } catch {
    return hold('INVARIANT_FAILED', 'the payee trust-line amounts cannot be verified');
  }
  return null;
}
