import { randomBytes } from 'node:crypto';

import type { EvidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import type { InvoiceExtraction } from '../../../../packages/shared/src/schemas/invoice.js';
import { buildContext } from '../context/build.js';
import type { RoleContext, SourceRecord } from '../context/types.js';
import { extractInvoice } from '../extract/extract.js';
import { holdReasonsOf, verifyInvoice, type VerifiedInvoice } from '../extract/verify.js';
import type { IntakeOutcome } from '../intake/intake.js';
import { ModelBudget, budgetedModel } from '../model/budget.js';
import type { ModelClient } from '../model/types.js';
import { accountKey, matchInvoice, type MatchResult, type VerifiedValues } from '../match/match.js';
import type { SupplierMaster } from '../match/supplier-master.js';
import { screenPages, type ScreenResult } from '../screen/injection.js';
import { decideRoute, type RouteDecision, type RouteFacts } from '../orchestrator/route-policy.js';
import { JUDGE_LATENCY_LIMIT_MS, judge, type JudgeAction } from '../orchestrator/judge.js';
import { draftReason, type ReasonResult } from '../orchestrator/reasons.js';
import { SwarmBudget, type BudgetSnapshot } from '../swarm/budget.js';
import { runReviewers, type ReviewOutcome } from '../swarm/reviewers.js';
import type { ReviewerRole } from '../swarm/schemas.js';

import {
  JUDGE_EDGE,
  assertEdge,
  isTerminal,
  type Move,
  type NodeName,
  type Terminal,
} from './edges.js';
import type { Checkpoint, CheckpointStore } from './checkpoint.js';

/**
 * The invoice graph. runInvoice walks the typed graph in edges.ts and writes a checkpoint at the end of each node, before
 * each budgeted model call, and before the submit call. A killed process resumes from its newest checkpoint with
 * resumeInvoice:
 *   - a node that had started runs again from its starting state; the budget already spent stays spent;
 *   - a run whose submit intent was written but whose result was not is NOT submitted again: it goes to needs-person.
 *
 * Model calls happen in four places only: extraction (one call, plus at most one repair), the reviewers (one call each,
 * in parallel), a repair of one reviewer, and an optional reason draft. Code makes every other decision.
 */

export const GRAPH_VERSION = 'graph-v1';

/** Illustrative amount bands in ZAR minor units (1 rand = 100). The owner confirms them before a live demo. */
export const AMOUNT_BAND_SMALL_MAX_MINOR = 1_000_000;
export const AMOUNT_BAND_MEDIUM_MAX_MINOR = 10_000_000;

export interface PaymentSnapshot {
  readonly correlationId: string;
  readonly supplierId: string;
  readonly obligationKey: string;
  readonly amountMinor: number;
}

/** The payment seam. A production adapter wraps WardenPort and AgentSigner. This graph holds no key. */
export interface PaymentPort {
  warden(snapshot: PaymentSnapshot): Promise<'APPROVED' | 'REFUSED'>;
  sign(snapshot: PaymentSnapshot): Promise<boolean>;
  submit(
    snapshot: PaymentSnapshot,
  ): Promise<{ readonly ok: true; readonly ledgerHash: string } | { readonly ok: false }>;
  reconcile(snapshot: PaymentSnapshot): Promise<'PAID' | 'NEEDS_PERSON'>;
}

export interface GraphDeps {
  readonly client: ModelClient;
  readonly checkpoints: CheckpointStore;
  /** eligibility stops at the Warden step; payment goes on through the payment port. */
  readonly mode: 'eligibility' | 'payment';
  readonly policyVersion: string;
  readonly evidence: EvidenceRegister;
  readonly suppliers: readonly SupplierMaster[];
  readonly alreadyPaid: (obligationKey: string) => boolean;
  /** The buyer's records for this invoice. The context builder decides which role sees each one. */
  readonly buyerRecords: (verified: VerifiedInvoice) => readonly SourceRecord[];
  /** The sender check result for an invoice fingerprint. UNKNOWN holds the invoice. */
  readonly senderCheck: (fingerprint: string) => 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly priorHolds: (supplierId: string | null) => number;
  /** The PO total in minor units, read from structured PO data, or null when it cannot be read. */
  readonly poAmountMinor: (verified: VerifiedInvoice) => number | null;
  readonly screen?: (pages: readonly string[]) => ScreenResult;
  readonly payments?: PaymentPort;
  readonly scanned?: boolean;
  readonly now?: () => number;
  readonly nonce?: () => string;
  readonly latencyLimitMs?: number;
  /** Test fault injection: throw SimulatedCrash after this many checkpoints have been written. */
  readonly crashAfterCheckpoints?: number;
}

export class SimulatedCrash extends Error {
  constructor() {
    super('simulated crash after a checkpoint');
    this.name = 'SimulatedCrash';
  }
}

export interface GraphData {
  readonly correlationId: string;
  readonly fingerprint: string | null;
  readonly pages: readonly string[];
  readonly startedAt: number;
  readonly trail: readonly string[];
  readonly intakeCode: string | null;
  readonly screenCodes: readonly string[];
  readonly extraction: {
    readonly ok: boolean;
    readonly reason: string | null;
    readonly value: InvoiceExtraction | null;
    readonly model: string | null;
  } | null;
  readonly verified: VerifiedInvoice | null;
  readonly route: RouteDecision | null;
  readonly supplierId: string | null;
  readonly match: MatchResult | null;
  readonly contexts: Readonly<Partial<Record<ReviewerRole, RoleContext>>>;
  readonly outcomes: readonly ReviewOutcome[];
  readonly pending: {
    readonly kind: 'repair' | 'add';
    readonly role: ReviewerRole;
    readonly issues: readonly string[];
  } | null;
  readonly decision: JudgeAction | null;
  readonly reason: ReasonResult | null;
  readonly submitIntent: boolean;
  readonly submitted: { readonly ledgerHash: string } | null;
  readonly finalCode: string | null;
}

export interface GraphResult {
  readonly correlationId: string;
  readonly terminal: Terminal;
  readonly finalCode: string;
  readonly reason: ReasonResult | null;
  readonly trail: readonly string[];
  readonly budget: BudgetSnapshot;
  readonly route: RouteDecision | null;
  readonly decision: JudgeAction | null;
  readonly data: GraphData;
}

interface Step {
  readonly next: Move;
  readonly patch: Partial<GraphData>;
  readonly code?: string;
}

interface Ctx {
  readonly deps: GraphDeps;
  readonly budget: SwarmBudget;
  readonly now: () => number;
  readonly nonce: () => string;
  readonly writeIntent: (data: GraphData) => void;
}

type NodeFn = (data: GraphData, ctx: Ctx) => Step | Promise<Step>;

function emptyData(correlationId: string, startedAt: number, outcome: IntakeOutcome): GraphData {
  const pages = outcome.kind === 'text-pdf' ? [...outcome.pages] : [];
  return {
    correlationId,
    fingerprint: outcome.fingerprint,
    pages,
    startedAt,
    trail: [],
    intakeCode: outcome.kind === 'held' ? `INTAKE_${outcome.reason}` : null,
    screenCodes: [],
    extraction: null,
    verified: null,
    route: null,
    supplierId: null,
    match: null,
    contexts: {},
    outcomes: [],
    pending: null,
    decision: null,
    reason: null,
    submitIntent: false,
    submitted: null,
    finalCode: null,
  };
}

/** Runs one invoice from intake until it reaches a terminal state. */
export async function runInvoice(
  input: { readonly correlationId: string; readonly outcome: IntakeOutcome },
  deps: GraphDeps,
): Promise<GraphResult> {
  const now = deps.now ?? Date.now;
  const data = emptyData(input.correlationId, now(), input.outcome);
  return drive(
    input.correlationId,
    {
      seq: 0,
      node: 'intake',
      phase: 'done',
      budget: { initial: 0, repair: 0 },
      data: data as unknown as Record<string, unknown>,
    },
    deps,
  );
}

/** Resumes a run from its newest checkpoint. A run with no checkpoint cannot be resumed. */
export async function resumeInvoice(correlationId: string, deps: GraphDeps): Promise<GraphResult> {
  const cp = deps.checkpoints.latest(correlationId);
  if (cp === null) {
    throw new Error('there is no checkpoint for this invoice to resume from');
  }
  const data = cp.data as unknown as GraphData;
  if (cp.phase === 'intent' && cp.node === 'submit') {
    // The submit call may already have reached the ledger. Only a person may decide, so it is not sent again.
    return finish(
      correlationId,
      { ...data, finalCode: 'SUBMIT_OUTCOME_UNKNOWN' },
      cp.budget,
      'needs-person',
      'SUBMIT_OUTCOME_UNKNOWN',
      (checkpoint) => {
        deps.checkpoints.save(correlationId, checkpoint);
      },
      cp.seq,
    );
  }
  return drive(correlationId, cp, deps);
}

async function drive(
  correlationId: string,
  start: Checkpoint,
  deps: GraphDeps,
): Promise<GraphResult> {
  const now = deps.now ?? Date.now;
  const nonce = deps.nonce ?? (() => randomBytes(12).toString('hex'));
  let seq = start.seq;
  let saved = 0;
  const write = (checkpoint: Omit<Checkpoint, 'seq'>): void => {
    seq += 1;
    deps.checkpoints.save(correlationId, { ...checkpoint, seq });
    saved += 1;
    if (deps.crashAfterCheckpoints !== undefined && saved >= deps.crashAfterCheckpoints) {
      throw new SimulatedCrash();
    }
  };

  let data = start.data as unknown as GraphData;
  let node: Move = start.node as Move;
  // A checkpoint in the spend or start phase names the node that was running, so that node runs again from its start.
  if (start.phase === 'spend') {
    node = start.node as NodeName;
  }
  let running: NodeName | null = null;
  const budget = new SwarmBudget(start.budget, (snapshot) => {
    if (running !== null) {
      write({
        node: running,
        phase: 'spend',
        budget: snapshot,
        data: data as unknown as Record<string, unknown>,
      });
    }
  });
  const ctx: Ctx = {
    deps,
    budget,
    now,
    nonce,
    writeIntent: (intent) => {
      write({
        node: 'submit',
        phase: 'intent',
        budget: budget.snapshot(),
        data: intent as unknown as Record<string, unknown>,
      });
    },
  };

  while (!isTerminal(node)) {
    const current: NodeName = node;
    running = current;
    // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
    const step = await NODE_FNS[current](data, ctx);
    assertEdge(current, step.next);
    running = null;
    data = {
      ...data,
      ...step.patch,
      trail: [...data.trail, current],
      finalCode: step.code ?? data.finalCode,
    };
    node = step.next;
    if (!isTerminal(node)) {
      write({
        node,
        phase: 'done',
        budget: budget.snapshot(),
        data: data as unknown as Record<string, unknown>,
      });
    }
  }
  const terminal: Terminal = node;
  const code = data.finalCode ?? defaultCode(terminal);
  return finish(
    correlationId,
    data,
    budget.snapshot(),
    terminal,
    code,
    (checkpoint) => {
      deps.checkpoints.save(correlationId, checkpoint);
    },
    seq,
  );
}

function defaultCode(terminal: Terminal): string {
  switch (terminal) {
    case 'paid':
      return 'PAID';
    case 'eligible':
      return 'ELIGIBLE';
    case 'held':
      return 'HELD';
    case 'refused':
      return 'REFUSED';
    case 'needs-person':
      return 'NEEDS_PERSON';
  }
}

function finish(
  correlationId: string,
  data: GraphData,
  budget: BudgetSnapshot,
  terminal: Terminal,
  code: string,
  save: (checkpoint: Checkpoint) => void,
  lastSeq: number,
): GraphResult {
  const finalData: GraphData = { ...data, finalCode: code };
  save({
    seq: lastSeq + 1,
    node: terminal,
    phase: 'done',
    budget,
    data: finalData as unknown as Record<string, unknown>,
  });
  return {
    correlationId,
    terminal,
    finalCode: code,
    reason: finalData.reason,
    trail: finalData.trail,
    budget,
    route: finalData.route,
    decision: finalData.decision,
    data: finalData,
  };
}

/* ---------- nodes ---------- */

const NODE_FNS: Readonly<Record<NodeName, NodeFn>> = {
  intake: intakeNode,
  classify: classifyNode,
  extract: extractNode,
  verify: verifyNode,
  route: routeNode,
  match: matchNode,
  review: reviewNode,
  judge: judgeNode,
  warden: wardenNode,
  sign: signNode,
  submit: submitNode,
  reconcile: reconcileNode,
};

function intakeNode(data: GraphData): Step {
  if (data.intakeCode !== null) {
    return { next: 'refused', patch: {}, code: data.intakeCode };
  }
  if (data.pages.length === 0) {
    return { next: 'refused', patch: {}, code: 'INTAKE_NO_TEXT' };
  }
  return { next: 'classify', patch: {} };
}

function classifyNode(data: GraphData, ctx: Ctx): Step {
  const screen =
    ctx.deps.screen !== undefined ? ctx.deps.screen(data.pages) : screenPages(data.pages);
  if (screen.flagged) {
    return { next: 'held', patch: { screenCodes: [...screen.codes] }, code: 'SCREEN_FLAGGED' };
  }
  return { next: 'extract', patch: { screenCodes: [] } };
}

async function extractNode(data: GraphData, ctx: Ctx): Promise<Step> {
  let calls = 0;
  const counted: ModelClient = {
    label: ctx.deps.client.label,
    async complete(request) {
      // The first call is an initial call; a second call from the extractor's own repair is the one repair.
      ctx.budget.spend(calls === 0 ? 'initial' : 'repair');
      calls += 1;
      return ctx.deps.client.complete(request);
    },
  };
  const inner = new ModelBudget(2);
  const result = await extractInvoice({
    pages: data.pages,
    model: budgetedModel(counted, inner),
    budget: inner,
    nonce: ctx.nonce,
  });
  if (!result.ok) {
    return {
      next: 'held',
      patch: { extraction: { ok: false, reason: result.reason, value: null, model: result.model } },
      code: `EXTRACTION_${result.reason}`,
    };
  }
  return {
    next: 'verify',
    patch: {
      extraction: { ok: true, reason: null, value: result.extraction, model: result.model },
    },
  };
}

function verifyNode(data: GraphData): Step {
  const value = data.extraction === null ? null : data.extraction.value;
  if (value === null) {
    return { next: 'held', patch: {}, code: 'EXTRACTION_MISSING' };
  }
  const verified = verifyInvoice(value, data.pages);
  if (holdReasonsOf(verified).length > 0) {
    return { next: 'held', patch: { verified }, code: 'VERIFY_HOLD' };
  }
  return { next: 'route', patch: { verified } };
}

export function valuesOf(verified: VerifiedInvoice): VerifiedValues | null {
  if (
    verified.supplierName.value === null ||
    verified.invoiceNumber.value === null ||
    verified.currency.value === null ||
    verified.total.value === null ||
    verified.purchaseOrderNumber.value === null
  ) {
    return null;
  }
  return {
    supplierName: verified.supplierName.value,
    invoiceNumber: verified.invoiceNumber.value,
    currency: verified.currency.value,
    totalMinor: verified.total.value.minor,
    purchaseOrderNumber: verified.purchaseOrderNumber.value,
    payeeAccountAsPrinted: verified.payeeAccountAsPrinted.value,
  };
}

function routeNode(data: GraphData, ctx: Ctx): Step {
  const verified = data.verified;
  if (verified === null || data.fingerprint === null) {
    return { next: 'held', patch: {}, code: 'ROUTE_NO_VERIFIED_FIELDS' };
  }
  const name = verified.supplierName.value ?? '';
  const supplier = ctx.deps.suppliers.find((s) => s.legalName === name) ?? null;
  const printed = verified.payeeAccountAsPrinted.value;
  const enrolled = supplier === null ? null : supplier.enrolledPayeeAsPrinted;
  // A supplier that is known but whose printed or enrolled account is missing counts as a bank change: fail closed.
  const bankChanged =
    supplier !== null &&
    (printed === null || enrolled === null || accountKey(printed) !== accountKey(enrolled));
  const minor = verified.total.value === null ? 0 : verified.total.value.minor;
  const facts: RouteFacts = {
    scan: ctx.deps.scanned ?? false,
    newSupplier: supplier === null,
    bankChanged,
    amountBand:
      minor < AMOUNT_BAND_SMALL_MAX_MINOR
        ? 'SMALL'
        : minor < AMOUNT_BAND_MEDIUM_MAX_MINOR
          ? 'MEDIUM'
          : 'LARGE',
    senderCheck: ctx.deps.senderCheck(data.fingerprint),
    priorHolds: ctx.deps.priorHolds(supplier === null ? null : supplier.supplierId),
  };
  const route = decideRoute(facts);
  const supplierId = supplier === null ? null : supplier.supplierId;
  if (route.route === 'HOLD') {
    return { next: 'held', patch: { route, supplierId }, code: route.holdCode ?? 'ROUTE_HOLD' };
  }
  return { next: 'match', patch: { route, supplierId } };
}

function matchNode(data: GraphData, ctx: Ctx): Step {
  const values = data.verified === null ? null : valuesOf(data.verified);
  if (values === null || data.fingerprint === null) {
    return { next: 'held', patch: {}, code: 'MATCH_INCOMPLETE' };
  }
  const result = matchInvoice({
    values,
    fingerprint: data.fingerprint,
    evidence: ctx.deps.evidence,
    suppliers: ctx.deps.suppliers,
    alreadyPaid: ctx.deps.alreadyPaid,
  });
  if (!result.ok) {
    return { next: 'held', patch: { match: result }, code: 'MATCH_HOLD' };
  }
  return { next: 'review', patch: { match: result } };
}

async function reviewNode(data: GraphData, ctx: Ctx): Promise<Step> {
  const route = data.route;
  const verified = data.verified;
  if (route === null || verified === null) {
    return { next: 'held', patch: {}, code: 'REVIEW_NO_ROUTE' };
  }
  const repairing = data.pending?.kind === 'repair' ? data.pending : null;
  const adding = data.pending?.kind === 'add' ? data.pending.role : null;
  const wanted: ReviewerRole[] =
    repairing !== null
      ? [repairing.role]
      : [...route.reviewers, ...(adding !== null ? [adding] : [])];
  const toRun =
    repairing !== null
      ? [repairing.role]
      : wanted.filter((role) => !data.outcomes.some((o) => o.role === role));

  const records = ctx.deps.buyerRecords(verified);
  const contexts: Partial<Record<ReviewerRole, RoleContext>> = { ...data.contexts };
  for (const role of wanted) {
    // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
    if (contexts[role] === undefined) {
      try {
        // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
        contexts[role] = buildContext(role, records, ctx.deps.policyVersion);
      } catch (error) {
        return { next: 'held', patch: {}, code: contextCodeOf(error) };
      }
    }
  }
  if (
    repairing !== null ? ctx.budget.remainingRepair < 1 : ctx.budget.remainingInitial < toRun.length
  ) {
    return { next: 'held', patch: {}, code: 'BUDGET_EXHAUSTED' };
  }
  const fresh = await runReviewers(
    toRun.map((role) => {
      // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
      const context = contexts[role];
      if (context === undefined) {
        throw new Error('a reviewer context is missing');
      }
      return {
        role,
        context,
        client: ctx.deps.client,
        budget: ctx.budget,
        nonce: ctx.nonce,
        now: ctx.now,
        ...(repairing !== null ? { repairIssues: repairing.issues } : {}),
      };
    }),
  );
  const kept = data.outcomes.filter((o) => !fresh.some((f) => f.role === o.role));
  return { next: 'judge', patch: { contexts, outcomes: [...kept, ...fresh], pending: null } };
}

function contextCodeOf(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return name === 'ContextBudgetError' ? 'CONTEXT_OVER_BUDGET' : 'CONTEXT_REFUSED';
}

async function judgeNode(data: GraphData, ctx: Ctx): Promise<Step> {
  const route = data.route;
  const verified = data.verified;
  if (route === null || verified === null || data.extraction === null) {
    return { next: 'held', patch: {}, code: 'JUDGE_INCOMPLETE' };
  }
  const poMinor = ctx.deps.poAmountMinor(verified);
  const total = verified.total.value === null ? null : verified.total.value.minor;
  const action = judge({
    route,
    extractionOk: data.extraction.ok,
    extractionReason: data.extraction.reason,
    outcomes: data.outcomes,
    contexts: data.contexts,
    codeChecks: {
      poAmountWithinTolerance: poMinor === null || total === null ? null : total <= poMinor,
    },
    budget: {
      remainingInitial: ctx.budget.remainingInitial,
      remainingRepair: ctx.budget.remainingRepair,
    },
    elapsedMs: ctx.now() - data.startedAt,
    latencyLimitMs: ctx.deps.latencyLimitMs ?? JUDGE_LATENCY_LIMIT_MS,
  });
  const next = JUDGE_EDGE[action.kind];
  if (action.kind === 'REPAIR') {
    return {
      next: 'review',
      patch: {
        decision: action,
        pending: { kind: 'repair', role: action.role, issues: [...action.issues] },
      },
    };
  }
  if (action.kind === 'ADD_REVIEWER') {
    return {
      next: 'review',
      patch: { decision: action, pending: { kind: 'add', role: action.role, issues: [] } },
    };
  }
  if (action.kind === 'HOLD') {
    const reason = await draftReason({
      code: action.reasonCode,
      client: ctx.deps.client,
      budget: ctx.budget,
      nonce: ctx.nonce,
    });
    return {
      next: 'held',
      patch: { decision: action, reason, pending: null },
      code: action.reasonCode,
    };
  }
  return { next, patch: { decision: action, pending: null } };
}

async function wardenNode(data: GraphData, ctx: Ctx): Promise<Step> {
  if (ctx.deps.mode === 'eligibility') {
    return { next: 'eligible', patch: {}, code: 'ELIGIBLE' };
  }
  const snapshot = paymentSnapshot(data);
  if (snapshot === null || ctx.deps.payments === undefined) {
    return { next: 'held', patch: {}, code: 'PAYMENT_NOT_CONFIGURED' };
  }
  const verdict = await ctx.deps.payments.warden(snapshot);
  return verdict === 'APPROVED'
    ? { next: 'sign', patch: {} }
    : { next: 'held', patch: {}, code: 'WARDEN_REFUSED' };
}

async function signNode(data: GraphData, ctx: Ctx): Promise<Step> {
  const snapshot = paymentSnapshot(data);
  if (snapshot === null || ctx.deps.payments === undefined) {
    return { next: 'needs-person', patch: {}, code: 'PAYMENT_NOT_CONFIGURED' };
  }
  const ok = await ctx.deps.payments.sign(snapshot);
  return ok
    ? { next: 'submit', patch: {} }
    : { next: 'needs-person', patch: {}, code: 'SIGN_FAILED' };
}

async function submitNode(data: GraphData, ctx: Ctx): Promise<Step> {
  const snapshot = paymentSnapshot(data);
  if (snapshot === null || ctx.deps.payments === undefined) {
    return { next: 'needs-person', patch: {}, code: 'PAYMENT_NOT_CONFIGURED' };
  }
  // The intent is written before the call. If the process dies after this write, resume never sends the payment again.
  ctx.writeIntent({ ...data, submitIntent: true });
  const result = await ctx.deps.payments.submit(snapshot);
  if (!result.ok) {
    return { next: 'needs-person', patch: { submitIntent: true }, code: 'SUBMIT_FAILED' };
  }
  return {
    next: 'reconcile',
    patch: { submitIntent: true, submitted: { ledgerHash: result.ledgerHash } },
  };
}

async function reconcileNode(data: GraphData, ctx: Ctx): Promise<Step> {
  const snapshot = paymentSnapshot(data);
  if (snapshot === null || ctx.deps.payments === undefined) {
    return { next: 'needs-person', patch: {}, code: 'PAYMENT_NOT_CONFIGURED' };
  }
  const state = await ctx.deps.payments.reconcile(snapshot);
  return state === 'PAID'
    ? { next: 'paid', patch: {}, code: 'PAID' }
    : { next: 'needs-person', patch: {}, code: 'RECONCILE_EXCEPTION' };
}

function paymentSnapshot(data: GraphData): PaymentSnapshot | null {
  if (data.supplierId === null || !data.match?.ok) {
    return null;
  }
  return {
    correlationId: data.correlationId,
    supplierId: data.supplierId,
    obligationKey: data.match.obligationKey,
    amountMinor: data.match.amountMinor,
  };
}
