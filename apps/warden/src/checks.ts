import type { WardenReasonCode } from '../../../packages/shared/src/schemas/index.js';

import { sha256Hex } from './canonical.js';
import type { GoodsReceiptRecord, InvoiceRecord, PurchaseOrderRecord } from './evidence.js';
import type { PreSigningFacts } from './ledger-read.js';
import { isUnresolved, type AttemptState, type LimitsState } from './state.js';
import { compareDecimal } from '../../../packages/xrpl/src/amounts.js';

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

export interface Tolerance {
  readonly absoluteMinor: number;
  readonly basisPoints: number;
}

/** The larger of the absolute allowance and the percentage allowance on the given amount. */
export function toleranceMinor(amountMinor: number, tolerance: Tolerance): number {
  return Math.max(
    tolerance.absoluteMinor,
    Math.floor((amountMinor * tolerance.basisPoints) / 10_000),
  );
}

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
  const orderGap = Math.abs(invoice.amountMinor - purchaseOrder.amountMinor);
  if (orderGap > toleranceMinor(purchaseOrder.amountMinor, tolerance)) {
    return hold(
      'AMOUNT_MISMATCH',
      'the invoice does not match the purchase order within tolerance',
    );
  }
  if (receipt === undefined) {
    return hold('MISSING_EVIDENCE', 'no goods receipt is recorded for the purchase order');
  }
  const covered = invoice.amountMinor - toleranceMinor(invoice.amountMinor, tolerance);
  if (receipt.receivedMinor < covered) {
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
  if (facts.destinationLine === null) {
    return hold('INVARIANT_FAILED', 'the payee cannot hold the asset');
  }
  if (facts.destinationLine.frozenByIssuer || facts.destinationLine.frozenByHolder) {
    return hold('ACCOUNT_FROZEN', 'the payee trust line is frozen');
  }
  return null;
}
