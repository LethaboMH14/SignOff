import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { obligationKey, sha256OfBytes } from '../../../../packages/shared/src/node.js';
import { parseMoneyText } from '../../../../packages/shared/src/money/minor-units.js';
import { intakeFile } from '../intake/intake.js';
import type { ModelClient } from '../model/types.js';
import { TransitionLog, type TransitionRecord } from '../log/transition-log.js';
import { processInvoice, type RunResult } from '../workflow/pipeline.js';
import type { VerifiedInvoice } from '../extract/verify.js';
import { runBaseline, type BaselineFields } from './baseline.js';
import type { LabelledCase, LabelledSet } from './cases.js';
import { rateOf, type Rate } from './metrics.js';

/**
 * Runs the pipeline and the single-prompt baseline over the labelled set, and scores both against the labels. Each
 * invoice is read from its PDF through the same intake the agent uses in production, so the text the models see is
 * the text the agent would see.
 */

export interface Readings {
  readonly supplierName: string | null;
  readonly invoiceNumber: string | null;
  readonly invoiceDate: string | null;
  readonly currency: string | null;
  readonly totalMinor: number | null;
  readonly purchaseOrderNumber: string | null;
  readonly payeeAccountAsPrinted: string | null;
}

export interface CaseRun {
  readonly id: string;
  readonly category: string;
  readonly expected: LabelledCase['expected'];
  readonly pipeline: {
    readonly decision: 'ELIGIBLE' | 'HOLD';
    readonly finalState: string;
    readonly reasonCode: string;
    /** The reason codes the run names, flattened to tokens such as "PAYEE_CHANGED" or "FIELD_NOT_STATED". */
    readonly tokens: readonly string[];
    readonly modelCalls: number;
    readonly fields: Readings;
  };
  readonly baseline: {
    readonly decision: 'ELIGIBLE' | 'HOLD';
    readonly parsed: boolean;
    readonly fields: Readings;
  };
}

export interface EvaluationInput {
  readonly set: LabelledSet;
  readonly model: ModelClient;
  readonly baselineModel: ModelClient;
  readonly policyVersion: string;
  readonly now: () => Date;
  readonly nonce?: () => string;
  /** Receives the moves of each case, in order, so a run can be exported for the agent map. Optional. */
  readonly onRecords?: (records: readonly TransitionRecord[]) => void;
}

const EMPTY: Readings = {
  supplierName: null,
  invoiceNumber: null,
  invoiceDate: null,
  currency: null,
  totalMinor: null,
  purchaseOrderNumber: null,
  payeeAccountAsPrinted: null,
};

/** Only verified (EXACT) values count as the pipeline's reading. Anything it abstained on is null. */
function readingsOf(verified: VerifiedInvoice | null): Readings {
  if (verified === null) {
    return EMPTY;
  }
  return {
    supplierName: verified.supplierName.value,
    invoiceNumber: verified.invoiceNumber.value,
    invoiceDate: verified.invoiceDate.value,
    currency: verified.currency.value,
    totalMinor: verified.total.value?.minor ?? null,
    purchaseOrderNumber: verified.purchaseOrderNumber.value,
    payeeAccountAsPrinted: verified.payeeAccountAsPrinted.value,
  };
}

/** The baseline's printed total becomes minor units only when the money rules accept it. */
function readingsOfBaseline(fields: BaselineFields | null): Readings {
  if (fields === null) {
    return EMPTY;
  }
  const minor =
    fields.totalAsPrinted !== null && fields.currency !== null
      ? parseMoneyText(
          fields.totalAsPrinted,
          fields.currency as 'ZAR' | 'USD' | 'EUR' | 'GBP' | 'ZMW',
        )
      : null;
  return {
    supplierName: fields.supplierName,
    invoiceNumber: fields.invoiceNumber,
    invoiceDate: fields.invoiceDate,
    currency: fields.currency,
    totalMinor: minor?.ok === true ? minor.minor : null,
    purchaseOrderNumber: fields.purchaseOrderNumber,
    payeeAccountAsPrinted: fields.payeeAccountAsPrinted,
  };
}

function tokensOf(result: RunResult): string[] {
  const parts = [result.reasonCode, ...result.reasons].flatMap((reason) => reason.split(':'));
  return [...new Set(parts)];
}

function nonceOf(): string {
  return randomBytes(12).toString('hex');
}

/**
 * Runs the cases in the set's order. A case the pipeline would approve clears its obligation for the rest of the run,
 * so a later re-sent copy of that obligation is held as a duplicate. The baseline has no such memory, which is the
 * point of the comparison. Each case still has its own transition log.
 */
export async function evaluate(input: EvaluationInput): Promise<CaseRun[]> {
  const runs: CaseRun[] = [];
  const cleared = new Set<string>();
  for (const item of input.set.cases) {
    runs.push(await evaluateCase(item, input, cleared));
  }
  return runs;
}

async function evaluateCase(
  item: LabelledCase,
  input: EvaluationInput,
  cleared: Set<string>,
): Promise<CaseRun> {
  const path = join(input.set.dir, item.file);
  const outcome = await intakeFile(path);
  const correlationId = outcome.fingerprint ?? sha256OfBytes(Buffer.from(path, 'utf8'));
  const log = TransitionLog.open(null, input.now);
  const result = await processInvoice(
    { correlationId, outcome },
    {
      model: input.model,
      evidence: input.set.evidence,
      suppliers: input.set.suppliers,
      log,
      policyVersion: input.policyVersion,
      now: input.now,
      newAttemptId: () => randomUUID(),
      nonce: input.nonce ?? nonceOf,
      warden: null,
      signer: null,
      alreadyClearedElsewhere: (key) => cleared.has(key),
    },
  );

  input.onRecords?.(log.records());
  const readings = readingsOf(result.verified);
  if (result.finalState === 'WARDEN_ELIGIBLE' && readings.invoiceNumber !== null) {
    cleared.add(obligationKey(item.supplierId, readings.invoiceNumber));
  }

  const baseline =
    outcome.kind === 'text-pdf'
      ? await runBaseline(outcome.pages, input.baselineModel, (input.nonce ?? nonceOf)())
      : { ok: false, decision: 'HOLD' as const, fields: null };

  return {
    id: item.id,
    category: item.category,
    expected: item.expected,
    pipeline: {
      decision: result.finalState === 'WARDEN_ELIGIBLE' ? 'ELIGIBLE' : 'HOLD',
      finalState: result.finalState,
      reasonCode: result.reasonCode,
      tokens: tokensOf(result),
      modelCalls: result.modelCalls,
      fields: readingsOf(result.verified),
    },
    baseline: {
      decision: baseline.decision,
      parsed: baseline.ok,
      fields: readingsOfBaseline(baseline.fields),
    },
  };
}

export interface Side {
  readonly decisionCounts: { readonly approved: number; readonly held: number };
  readonly falseApprovals: Rate;
  readonly falseHolds: Rate;
  readonly decisionAccuracy: Rate;
  readonly reasonFound: Rate;
  readonly fieldPrecision: Rate;
  readonly fieldRecall: Rate;
  readonly fieldWrong: Rate;
  readonly emptyCorrect: Rate;
}

const FIELD_KEYS = [
  'supplierName',
  'invoiceNumber',
  'invoiceDate',
  'currency',
  'totalMinor',
  'purchaseOrderNumber',
  'payeeAccountAsPrinted',
] as const;

interface Scored {
  readonly decision: 'ELIGIBLE' | 'HOLD';
  readonly tokens: readonly string[];
  readonly fields: Readings;
}

function scoreSide(runs: readonly CaseRun[], pick: (run: CaseRun) => Scored): Side {
  let expectedHold = 0;
  let expectedEligible = 0;
  let falseApprovals = 0;
  let falseHolds = 0;
  let decisionsRight = 0;
  let reasonsExpected = 0;
  let reasonsFound = 0;
  let predicted = 0;
  let correct = 0;
  let truthPresent = 0;
  let recalled = 0;
  let truthAbsent = 0;
  let emptyRight = 0;
  let approved = 0;

  for (const run of runs) {
    const side = pick(run);
    const expectedDecision = run.expected.decision;
    if (side.decision === 'ELIGIBLE') approved += 1;
    if (expectedDecision === 'HOLD') {
      expectedHold += 1;
      if (side.decision === 'ELIGIBLE') falseApprovals += 1;
      if (run.expected.reason !== null) {
        reasonsExpected += 1;
        if (side.decision === 'HOLD' && side.tokens.includes(run.expected.reason))
          reasonsFound += 1;
      }
    } else {
      expectedEligible += 1;
      if (side.decision === 'HOLD') falseHolds += 1;
    }
    if (side.decision === expectedDecision) decisionsRight += 1;

    for (const key of FIELD_KEYS) {
      const truth: string | number | null = Reflect.get(run.expected.fields, key);
      const value: string | number | null = Reflect.get(side.fields, key);
      if (value !== null) {
        predicted += 1;
        if (truth !== null && value === truth) correct += 1;
      }
      if (truth !== null) {
        truthPresent += 1;
        if (value === truth) recalled += 1;
      } else {
        truthAbsent += 1;
        if (value === null) emptyRight += 1;
      }
    }
  }

  return {
    decisionCounts: { approved, held: runs.length - approved },
    falseApprovals: rateOf(falseApprovals, expectedHold),
    falseHolds: rateOf(falseHolds, expectedEligible),
    decisionAccuracy: rateOf(decisionsRight, runs.length),
    reasonFound: rateOf(reasonsFound, reasonsExpected),
    fieldPrecision: rateOf(correct, predicted),
    fieldRecall: rateOf(recalled, truthPresent),
    fieldWrong: rateOf(predicted - correct, predicted),
    emptyCorrect: rateOf(emptyRight, truthAbsent),
  };
}

export function scorePipeline(runs: readonly CaseRun[]): Side {
  return scoreSide(runs, (run) => ({
    decision: run.pipeline.decision,
    tokens: run.pipeline.tokens,
    fields: run.pipeline.fields,
  }));
}

/** The baseline names no reasons, so it cannot be credited for one. Its reason rate is therefore zero by design. */
export function scoreBaseline(runs: readonly CaseRun[]): Side {
  return scoreSide(runs, (run) => ({
    decision: run.baseline.decision,
    tokens: [],
    fields: run.baseline.fields,
  }));
}

/** The per-case scores (higher is better) that the statistics compare. One value per case, in set order. */
export interface PerCaseScores {
  /** 1 when the decision matches the label, else 0. */
  readonly decision: readonly number[];
  /** The share of the seven labelled fields read exactly as labelled, null counting as right when the label is null. */
  readonly fields: readonly number[];
  /** 0 for a false approval (label HOLD, decided ELIGIBLE), else 1. */
  readonly noFalseApproval: readonly number[];
}

export function perCaseScores(
  runs: readonly CaseRun[],
  side: 'pipeline' | 'baseline',
): PerCaseScores {
  const decision: number[] = [];
  const fields: number[] = [];
  const noFalseApproval: number[] = [];
  for (const run of runs) {
    const picked: Scored =
      side === 'pipeline'
        ? {
            decision: run.pipeline.decision,
            tokens: run.pipeline.tokens,
            fields: run.pipeline.fields,
          }
        : { decision: run.baseline.decision, tokens: [], fields: run.baseline.fields };
    decision.push(picked.decision === run.expected.decision ? 1 : 0);
    const right = FIELD_KEYS.filter(
      (key) => Reflect.get(picked.fields, key) === Reflect.get(run.expected.fields, key),
    ).length;
    fields.push(right / FIELD_KEYS.length);
    noFalseApproval.push(
      run.expected.decision === 'HOLD' && picked.decision === 'ELIGIBLE' ? 0 : 1,
    );
  }
  return { decision, fields, noFalseApproval };
}

/** Per-category counts of wrong decisions, for the report. */
export function byCategory(
  runs: readonly CaseRun[],
): Map<string, { n: number; pipelineWrong: number; baselineWrong: number }> {
  const table = new Map<string, { n: number; pipelineWrong: number; baselineWrong: number }>();
  for (const run of runs) {
    const row = table.get(run.category) ?? { n: 0, pipelineWrong: 0, baselineWrong: 0 };
    row.n += 1;
    if (run.pipeline.decision !== run.expected.decision) row.pipelineWrong += 1;
    if (run.baseline.decision !== run.expected.decision) row.baselineWrong += 1;
    table.set(run.category, row);
  }
  return table;
}
