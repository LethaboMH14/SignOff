import type { EvidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import { PaymentProposal } from '../../../../packages/shared/src/schemas/proposal.js';
import type { WardenDecision } from '../../../../packages/shared/src/schemas/warden-decision.js';
import type { CoSignResult, ProposeResult } from '../../../../packages/warden-api/src/contract.js';
import { extractInvoice } from '../extract/extract.js';
import { holdReasonsOf, verifyInvoice, type VerifiedInvoice } from '../extract/verify.js';
import type { IntakeOutcome } from '../intake/intake.js';
import { budgetedModel, ModelBudget } from '../model/budget.js';
import type { ModelClient } from '../model/types.js';
import { matchInvoice, type VerifiedValues } from '../match/match.js';
import { screenInvoice, type ScreenCandidate } from '../match/fraud-screen.js';
import type { Tolerance } from '../../../../packages/shared/src/match-rules.js';
import type { SupplierMaster } from '../match/supplier-master.js';
import { screenDocument, type ScreenInput, type ScreenResult } from '../screen/injection.js';
import { scanAmountHold } from '../text/scan-amount.js';
import {
  type Actor,
  type Evidence,
  type TransitionLog,
  type TransitionRecord,
} from '../log/transition-log.js';

import type { UsdConversion } from './fx-convert.js';
import { DefinitiveRefusal, type WardenPort } from './warden-port.js';
import type { State } from './states.js';

/**
 * The workflow. Its order is fixed in code: intake, screen, extract, verify, match, Warden, sign, submit, reconcile.
 * The model is called at one point only, and never chooses a step. Each move is written to the log before the next
 * step runs, and a move the state table does not allow cannot be written at all.
 *
 * Anything the pipeline cannot be sure of is held or put into reconciliation, never retried blind. A lost answer
 * from the Warden after a payment was sent is an unknown outcome, and only a person reconciles it.
 */

export const WORKFLOW_VERSION = 'workflow-v1';

/** Signs the prepared unsigned transaction with the agent key only. Warden adds the final signature later. */
export interface AgentSigner {
  readonly coSign: (toCoSign: string) => string;
}

export interface PipelineDeps {
  readonly model: ModelClient;
  readonly evidence: EvidenceRegister;
  readonly suppliers: readonly SupplierMaster[];
  readonly log: TransitionLog;
  readonly policyVersion: string;
  readonly now: () => Date;
  readonly newAttemptId: () => string;
  readonly nonce?: () => string;
  /**
   * Converts a rand amount (cents) to the Warden's USD minor units at a live rate. Absent means a rand invoice is
   * held with FX_UNAVAILABLE. Rejected conversions hold the invoice too.
   */
  readonly convert?: (zarMinor: number) => Promise<UsdConversion>;
  /** Null for a run that stops at eligibility, which is how the evaluation runs. */
  readonly warden: WardenPort | null;
  readonly signer: AgentSigner | null;
  /**
   * Evaluation only: obligations that an earlier case in the same run has already cleared for payment. The agent
   * itself never sets it, so production behaviour is unchanged when it is absent.
   */
  readonly alreadyClearedElsewhere?: (obligationKey: string) => boolean;
  /** The buyer's payment history, for screening. Absent means no history to compare against. */
  readonly paymentHistory?: readonly ScreenCandidate[];
  /** The split threshold (policy). Absent turns the split check off, which the README states as a limit. */
  readonly splitThresholdMinor?: number;
  /** The buyer's match tolerance. Absent uses the shared default. */
  readonly matchTolerance?: Tolerance;
}

export interface RunResult {
  readonly correlationId: string;
  readonly finalState: State;
  readonly reasonCode: string;
  readonly reasons: readonly string[];
  /** The rand-to-USD conversion the Warden was asked to pay, with its rate and source; null for USD invoices. */
  readonly fx: UsdConversion | null;
  readonly obligationKey: string | null;
  readonly attemptId: string | null;
  readonly wardenDecision: WardenDecision['decision'] | null;
  readonly ledgerHash: string | null;
  readonly modelCalls: number;
  /** The verified fields, in memory only. They are never written to the log, which holds hashes. */
  readonly verified: VerifiedInvoice | null;
  readonly screen: ScreenResult | null;
}

interface RunState {
  reasonCode: string;
  reasons: readonly string[];
  obligationKey: string | null;
  attemptId: string | null;
  wardenDecision: WardenDecision['decision'] | null;
  ledgerHash: string | null;
  modelCalls: number;
  modelLabel: string | null;
  recordSha256s: string[];
  quoteSha256s: string[];
  screenCodes: string[];
  verified: VerifiedInvoice | null;
  screen: ScreenResult | null;
  fx: UsdConversion | null;
}

const WARDEN_CODE = (code: string): string => `WARDEN_${code}`;

function quoteHashesOf(verified: VerifiedInvoice): string[] {
  const fields = [
    verified.supplierName,
    verified.invoiceNumber,
    verified.invoiceDate,
    verified.currency,
    verified.total,
    verified.purchaseOrderNumber,
    verified.payeeAccountAsPrinted,
  ];
  const hashes = fields.flatMap((field) => (field.quoteSha256 === null ? [] : [field.quoteSha256]));
  return [...new Set(hashes)];
}

function valuesOf(verified: VerifiedInvoice): VerifiedValues | null {
  const {
    supplierName,
    invoiceNumber,
    currency,
    total,
    purchaseOrderNumber,
    payeeAccountAsPrinted,
  } = verified;
  if (
    supplierName.value === null ||
    invoiceNumber.value === null ||
    currency.value === null ||
    total.value === null ||
    purchaseOrderNumber.value === null
  ) {
    return null;
  }
  return {
    supplierName: supplierName.value,
    invoiceNumber: invoiceNumber.value,
    currency: currency.value,
    totalMinor: total.value.minor,
    purchaseOrderNumber: purchaseOrderNumber.value,
    payeeAccountAsPrinted: payeeAccountAsPrinted.value,
  };
}

/** Runs one invoice through the fixed sequence and returns where it ended. */
export async function processInvoice(
  input: { readonly correlationId: string; readonly outcome: IntakeOutcome },
  deps: PipelineDeps,
): Promise<RunResult> {
  const { correlationId, outcome } = input;
  const fileSha256 = outcome.fingerprint;
  const run: RunState = {
    fx: null,
    reasonCode: 'OK',
    reasons: [],
    obligationKey: null,
    attemptId: null,
    wardenDecision: null,
    ledgerHash: null,
    modelCalls: 0,
    modelLabel: null,
    recordSha256s: [],
    quoteSha256s: [],
    screenCodes: [],
    verified: null,
    screen: null,
  };

  const move = (
    toState: State,
    actor: Actor,
    reasonCode: string,
    reasons: readonly string[] = [],
  ): TransitionRecord => {
    run.reasonCode = reasonCode;
    run.reasons = [...reasons];
    const evidence: Evidence = {
      fileSha256: fileSha256,
      recordSha256s: [...run.recordSha256s],
      quoteSha256s: [...run.quoteSha256s],
      model: run.modelLabel,
      modelCalls: run.modelCalls,
      screenCodes: [...run.screenCodes],
    };
    return deps.log.append({
      correlationId,
      obligationKey: run.obligationKey,
      toState,
      actor,
      reasonCode,
      reasons,
      policyVersion: deps.policyVersion,
      attemptId: run.attemptId,
      ledgerHash: run.ledgerHash,
      evidence,
    });
  };

  const finish = (): RunResult => ({
    correlationId,
    finalState: deps.log.stateOf(correlationId) ?? 'RECEIVED',
    reasonCode: run.reasonCode,
    reasons: run.reasons,
    fx: run.fx,
    obligationKey: run.obligationKey,
    attemptId: run.attemptId,
    wardenDecision: run.wardenDecision,
    ledgerHash: run.ledgerHash,
    modelCalls: run.modelCalls,
    verified: run.verified,
    screen: run.screen,
  });

  // 1. Intake. A file that is not a readable text PDF is quarantined before anything else reads it.
  move('RECEIVED', 'intake', 'OK');
  if (outcome.kind === 'held') {
    move('QUARANTINED', 'intake', outcome.reason);
    return finish();
  }
  if (outcome.kind === 'seen') {
    // The bytes were handled before. The earlier run's record stands; nothing is read again.
    move('QUARANTINED', 'intake', 'ALREADY_HANDLED');
    return finish();
  }

  // 2. Screen. Every source the intake read is screened: pages or OCR text, annotations and document information. A
  // document that carries steering text is quarantined, and no model reads it.
  const screen = screenDocument(screenInputOf(outcome));
  run.screen = screen;
  run.screenCodes = [...screen.codes];
  if (screen.flagged) {
    move('QUARANTINED', 'screen', screen.codes[0] ?? 'SCREEN_FLAGGED', screen.codes);
    return finish();
  }

  // 3. Extract. The one model call site, budgeted to three calls per invoice.
  const budget = new ModelBudget();
  const extracted = await extractInvoice({
    pages: outcome.pages,
    model: budgetedModel(deps.model, budget),
    budget,
    ...(deps.nonce === undefined ? {} : { nonce: deps.nonce }),
  });
  run.modelCalls = budget.callsUsed;
  run.modelLabel = extracted.model;
  if (!extracted.ok) {
    // The reason names the class of the failure (for example RATE_LIMIT or NOT_JSON), so a hold says what went wrong.
    move(
      extracted.reason === 'DOCUMENT_TOO_LONG' ? 'QUARANTINED' : 'HELD',
      'extractor',
      extracted.reason,
      extracted.detail === null ? [] : [extracted.detail],
    );
    return finish();
  }
  move('EXTRACTED', 'extractor', 'OK');

  // 4. Verify. Every required field must be verified against the document, or the invoice is held.
  const verified = verifyInvoice(extracted.extraction, outcome.pages);
  run.verified = verified;
  run.quoteSha256s = quoteHashesOf(verified);
  const verificationHolds = holdReasonsOf(verified);
  if (verificationHolds.length > 0) {
    move('HELD', 'verifier', 'VERIFICATION_FAILED', verificationHolds);
    return finish();
  }
  move('EVIDENCE_VERIFIED', 'verifier', 'OK');
  const values = valuesOf(verified);
  if (values === null || fileSha256 === null) {
    move('HELD', 'verifier', 'VERIFICATION_FAILED', ['internal:required-values']);
    return finish();
  }
  // A scanned page is read twice: the model's verified total must be confirmed by the fixed rules on the same OCR text.
  if (outcome.kind === 'text-ocr') {
    const scanHold = scanAmountHold(outcome.pages.join('\n'), values.totalMinor);
    if (scanHold !== null) {
      move('HELD', 'verifier', scanHold);
      return finish();
    }
  }

  // 5. Match. The invoice must agree with the buyer's own records, which the document cannot write.
  const match = matchInvoice({
    values,
    fingerprint: fileSha256,
    evidence: deps.evidence,
    suppliers: deps.suppliers,
    alreadyPaid: (key) =>
      deps.log.blocksPayment(key) || (deps.alreadyClearedElsewhere?.(key) ?? false),
    ...(deps.matchTolerance === undefined ? {} : { tolerance: deps.matchTolerance }),
  });
  run.recordSha256s = [...match.recordSha256s];
  run.obligationKey = match.obligationKey;
  if (!match.ok) {
    move('HELD', 'matcher', 'MATCH_FAILED', match.reasons);
    return finish();
  }

  // 5b. Screen against the payment history: re-saved or revised copies, near-duplicate numbers, split payments and
  // dates that cannot be right. Every hit is a hold for a person, never a payment.
  const invoiceDate = verified.invoiceDate.value;
  if (invoiceDate === null) {
    move('HELD', 'matcher', 'VERIFICATION_FAILED', ['internal:invoice-date']);
    return finish();
  }
  const screened = screenInvoice(
    {
      fingerprint: fileSha256,
      supplierId: match.supplierId,
      invoiceNumber: values.invoiceNumber,
      amountMinor: match.amountMinor,
      payeeAccountAsPrinted: values.payeeAccountAsPrinted,
      invoiceDate,
    },
    deps.paymentHistory ?? [],
    {
      now: deps.now(),
      splitThresholdMinor: deps.splitThresholdMinor ?? null,
      ...(deps.matchTolerance === undefined ? {} : { tolerance: deps.matchTolerance }),
    },
  );
  if (screened.holds.length > 0) {
    move('HELD', 'matcher', 'SCREEN_HOLD', [...screened.holds]);
    return finish();
  }
  move('WARDEN_ELIGIBLE', 'matcher', 'OK');
  if (deps.warden === null) {
    return finish();
  }
  return submit(
    {
      supplierId: match.supplierId,
      currency: values.currency,
      amountMinor: match.amountMinor,
      fileSha256,
    },
    deps,
    run,
    move,
    finish,
  );
}

/** Every text source of an accepted document, for the screen. Held and already-handled files never reach it. */
function screenInputOf(outcome: IntakeOutcome): ScreenInput {
  if (outcome.kind === 'text-ocr') {
    return { pages: outcome.pages, method: 'ocr', annotations: [], metadata: [] };
  }
  if (outcome.kind === 'text-pdf') {
    return {
      pages: outcome.pages,
      method: 'text-layer',
      annotations: outcome.extras.annotations,
      metadata: outcome.extras.metadata,
    };
  }
  return { pages: [], method: 'text-layer', annotations: [], metadata: [] };
}

interface Payable {
  readonly supplierId: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly fileSha256: string;
}

type Priced =
  | {
      readonly kind: 'ok';
      readonly payable: Payable;
      readonly conversion: UsdConversion | null;
    }
  | { readonly kind: 'held'; readonly code: string; readonly reason: string };

/**
 * The amount the Warden is asked to pay, in its payable currency. USD passes unchanged. ZAR is converted at the
 * live rate (fx-convert.ts); the conversion, with its rate and source, is kept on the run result. Any other
 * currency, or a failed conversion, holds the invoice: nothing is guessed.
 */
async function priceInPayableCurrency(input: Payable, deps: PipelineDeps): Promise<Priced> {
  if (input.currency === 'USD') {
    return { kind: 'ok', payable: input, conversion: null };
  }
  if (input.currency !== 'ZAR') {
    return {
      kind: 'held',
      code: 'CURRENCY_NOT_PAYABLE',
      reason: `the invoice currency ${input.currency} has no payable asset`,
    };
  }
  if (deps.convert === undefined) {
    return {
      kind: 'held',
      code: 'FX_UNAVAILABLE',
      reason: 'no live USD/ZAR rate is configured for this run',
    };
  }
  try {
    const conversion = await deps.convert(input.amountMinor);
    return {
      kind: 'ok',
      payable: { ...input, currency: conversion.currency, amountMinor: conversion.amountMinor },
      conversion,
    };
  } catch (error) {
    return {
      kind: 'held',
      code: 'FX_UNAVAILABLE',
      reason: error instanceof Error ? error.message : 'the rate could not be obtained',
    };
  }
}

/** Steps 6 to 9: get unsigned Warden terms, agent-sign, request final Warden authorization, reconcile. */
async function submit(
  input: Payable,
  deps: PipelineDeps,
  run: RunState,
  move: (
    toState: State,
    actor: Actor,
    reasonCode: string,
    reasons?: readonly string[],
  ) => TransitionRecord,
  finish: () => RunResult,
): Promise<RunResult> {
  const warden = deps.warden;
  if (warden === null || run.obligationKey === null) {
    move('HELD', 'matcher', 'INTERNAL_STATE');
    return finish();
  }

  // The Warden pays USD (RLUSD). A rand invoice is converted at a live rate here, or it is held.
  const priced = await priceInPayableCurrency(input, deps);
  if (priced.kind === 'held') {
    move('HELD', 'matcher', priced.code, [priced.reason]);
    return finish();
  }
  const payable = priced.payable;
  run.fx = priced.conversion;

  const attemptId = deps.newAttemptId();
  const proposed = PaymentProposal.safeParse({
    schemaVersion: 1,
    obligationKey: run.obligationKey,
    attemptId,
    supplierId: payable.supplierId,
    currency: payable.currency,
    amountMinor: payable.amountMinor,
    invoiceFingerprint: payable.fileSha256,
    policyVersion: deps.policyVersion,
    proposedBy: 'agent',
    proposedAt: deps.now().toISOString(),
  });
  if (!proposed.success) {
    move('HELD', 'matcher', 'PROPOSAL_INVALID');
    return finish();
  }

  // 6. Warden. The agent proposes; the Warden decides.
  let answer: ProposeResult;
  try {
    answer = await warden.propose(proposed.data);
  } catch (error) {
    if (error instanceof DefinitiveRefusal) {
      run.attemptId = null;
      move('HELD', 'warden', 'WARDEN_REFUSED_REQUEST');
    } else {
      run.attemptId = attemptId;
      move('RECONCILIATION_EXCEPTION', 'warden', 'PROPOSE_OUTCOME_UNKNOWN');
    }
    return finish();
  }
  run.wardenDecision = answer.decision.decision;
  if (answer.attemptId === null) {
    run.attemptId = null;
    move(
      'HELD',
      'warden',
      WARDEN_CODE(answer.decision.decision),
      answer.decision.reasons.map((reason) => WARDEN_CODE(reason.code)),
    );
    return finish();
  }
  run.attemptId = answer.attemptId;
  if (answer.attemptId !== attemptId) {
    move('RECONCILIATION_EXCEPTION', 'warden', 'ATTEMPT_ID_MISMATCH');
    return finish();
  }
  if (answer.decision.decision !== 'ALLOW') {
    move(
      'HELD',
      'warden',
      WARDEN_CODE(answer.decision.decision),
      answer.decision.reasons.map((reason) => WARDEN_CODE(reason.code)),
    );
    return finish();
  }
  if (answer.toCoSign === null || deps.signer === null) {
    move('HELD', 'warden', 'WARDEN_NO_TRANSACTION');
    return finish();
  }

  // 7. Sign. The agent signs only its own half of Warden's unsigned transaction. A signing failure leaves Warden's attempt
  // open, so it goes to reconciliation rather than being retried.
  let blob: string;
  try {
    blob = deps.signer.coSign(answer.toCoSign);
  } catch {
    move('RECONCILIATION_EXCEPTION', 'signer', 'SIGNING_FAILED');
    return finish();
  }
  move('SIGNED', 'signer', 'OK');

  // 8. Submit. The state is written before the request leaves, so a crash in between is visible on restart.
  move('SUBMITTED', 'submitter', 'SENT');
  let result: CoSignResult;
  try {
    result = await warden.coSign(attemptId, blob);
  } catch (error) {
    if (error instanceof DefinitiveRefusal) {
      move('HELD', 'warden', 'WARDEN_REFUSED_COSIGN');
    } else {
      move('RECONCILIATION_EXCEPTION', 'submitter', 'OUTCOME_UNKNOWN');
    }
    return finish();
  }
  run.ledgerHash = /^[0-9A-F]{64}$/.test(result.hash) ? result.hash : null;

  // 9. Reconcile. The answer must name this attempt, and a paid answer must carry a ledger hash.
  if (result.attemptId !== attemptId) {
    move('RECONCILIATION_EXCEPTION', 'reconciler', 'RESULT_MISMATCH');
  } else if (result.outcome === 'paid') {
    if (run.ledgerHash === null) {
      move('RECONCILIATION_EXCEPTION', 'reconciler', 'RESULT_UNREADABLE');
    } else {
      move('VALIDATED', 'warden', 'PAID');
      move('RECONCILED', 'reconciler', 'MATCHED');
    }
  } else if (
    result.outcome === 'failed' ||
    result.outcome === 'rejected' ||
    result.outcome === 'expired'
  ) {
    move('FAILED', 'warden', result.outcome.toUpperCase());
  } else if (result.outcome === 'held') {
    move('HELD', 'warden', 'WARDEN_HELD_AT_SUBMISSION');
  } else {
    move('RECONCILIATION_EXCEPTION', 'warden', 'OUTCOME_PENDING');
  }
  return finish();
}
