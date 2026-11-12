import { randomUUID } from 'node:crypto';

import type { SourceRecord } from '../context/types.js';
import type { VerifiedInvoice } from '../extract/verify.js';
import { intakeFile } from '../intake/intake.js';
import type { ModelClient, ModelRequest } from '../model/types.js';
import { MemoryCheckpointStore } from '../graph/checkpoint.js';
import { runInvoice, type GraphDeps } from '../graph/run.js';
import { processInvoice } from '../workflow/pipeline.js';
import { TransitionLog } from '../log/transition-log.js';
import type { LabelledCase, LabelledSet } from '../eval/cases.js';
import { formatMinor } from './money.js';

/**
 * The three arms of the paired experiment. Every arm sees the same invoice file, the same buyer records and the same live
 * provider settings. They differ only in how the model is used:
 *
 *   single   the existing workflow: one extraction call, code checks, eligibility (no reviewers, no judge).
 *   placebo  the single arm with a neutral sentence added to the extractor's system prompt. It measures noise: a prompt
 *            change that is no better than this sentence is not an effect (vault: a placebo moved scores by 2.6 points).
 *   swarm    the invoice graph: extractor, route policy, the reviewers when the route asks for them, and the judge.
 *
 * Every model call is metered, so tokens are counted from the text sent and received (characters divided by four). The
 * count is an estimate, not the provider's usage field, and the report says so.
 */

export const PLACEBO_LINE =
  'Answer in a neutral register. Keep your reply in the requested format and nothing else.';

export interface Meter {
  readonly client: ModelClient;
  readonly stats: { calls: number; inChars: number; outChars: number; failures: number };
  reset(): void;
}

/** Wraps a client and counts its calls and characters. Failures are counted and rethrown. */
export function metered(inner: ModelClient): Meter {
  const stats = { calls: 0, inChars: 0, outChars: 0, failures: 0 };
  return {
    client: {
      label: inner.label,
      async complete(request: ModelRequest) {
        stats.calls += 1;
        stats.inChars += request.messages.reduce(
          (total, message) => total + message.content.length,
          0,
        );
        try {
          const reply = await inner.complete(request);
          stats.outChars += reply.text.length;
          return reply;
        } catch (error) {
          stats.failures += 1;
          throw error;
        }
      },
    },
    stats,
    reset() {
      stats.calls = 0;
      stats.inChars = 0;
      stats.outChars = 0;
      stats.failures = 0;
    },
  };
}

/** Adds the placebo sentence to the first (system) message only. The user message, and so the invoice, is unchanged. */
export function placeboOf(inner: ModelClient): ModelClient {
  return {
    label: `${inner.label}+placebo`,
    complete(request: ModelRequest) {
      const [first, ...rest] = request.messages;
      const messages =
        first === undefined
          ? request.messages
          : [{ ...first, content: `${first.content}\n${PLACEBO_LINE}` }, ...rest];
      return inner.complete({ ...request, messages });
    },
  };
}

/** The buyer's records for one invoice, as text. Built from the evidence register, the way a buyer's systems would supply them. */
export function buyerRecordsFor(set: LabelledSet, fingerprint: string): readonly SourceRecord[] {
  const invoice = set.evidence.invoice(fingerprint);
  const poId = invoice?.purchaseOrderId ?? null;
  const po = poId === null ? undefined : set.evidence.purchaseOrder(poId);
  const grn = poId === null ? undefined : set.evidence.goodsReceipt(poId);
  const supplier = set.suppliers.find((s) => s.supplierId === invoice?.supplierId);
  const records: SourceRecord[] = [];
  if (po !== undefined) {
    records.push({
      id: 'po',
      kind: 'PO',
      provenance: `PO record ${po.purchaseOrderId}`,
      text: `Purchase order ${po.purchaseOrderId}. Amount ${formatMinor(po.amountMinor)} ${po.currency}.`,
    });
  }
  if (grn !== undefined) {
    records.push({
      id: 'grn',
      kind: 'GRN',
      provenance: `goods receipt for ${grn.purchaseOrderId}`,
      text: `Goods receipt for ${grn.purchaseOrderId}. Received ${formatMinor(grn.receivedMinor)} ${po?.currency ?? ''} in full.`,
    });
  }
  if (supplier !== undefined) {
    const enrolled = supplier.enrolledPayeeAsPrinted ?? 'none on file';
    records.push(
      {
        id: 'supplier',
        kind: 'SUPPLIER_RECORD',
        provenance: `supplier master ${supplier.supplierId}`,
        text: `${supplier.legalName}. Status ${supplier.status}. Enrolled payee account ${enrolled}.`,
      },
      {
        id: 'payee',
        kind: 'PAYEE_EVIDENCE',
        provenance: `enrolled payee for ${supplier.supplierId}`,
        text: `Enrolled payee account ${enrolled}.`,
      },
    );
  }
  records.push({
    id: 'history',
    kind: 'SUPPLIER_HISTORY',
    provenance: 'supplier payment history (not modelled in the labelled set)',
    text: 'No payment history is modelled for this labelled case.',
  });
  records.push({
    id: 'sender',
    kind: 'SENDER_CHECK',
    provenance: 'sender check (not modelled in the labelled set)',
    text: 'Sender check not modelled for this labelled case.',
  });
  records.push({
    id: 'policy',
    kind: 'POLICY',
    provenance: 'policy-v1',
    text: 'Purchase order variance tolerance is zero in this experiment.',
  });
  return records;
}

export interface ArmResult {
  readonly decision: 'ELIGIBLE' | 'HOLD';
  readonly code: string;
  readonly verified: VerifiedInvoice | null;
  readonly modelCalls: number;
  readonly failures: number;
  readonly inChars: number;
  readonly outChars: number;
  readonly latencyMs: number;
  readonly route: string | null;
}

export interface ArmContext {
  readonly set: LabelledSet;
  readonly cleared: Set<string>;
  readonly now: () => number;
}

/** The single arm: the existing workflow, unchanged, stopped at eligibility. */
export async function runSingle(
  item: LabelledCase,
  client: Meter,
  ctx: ArmContext,
): Promise<ArmResult> {
  client.reset();
  const started = ctx.now();
  const path = `${ctx.set.dir}/${item.file}`;
  const outcome = await intakeFile(path);
  if (outcome.kind !== 'text-pdf') {
    return emptyResult('HOLD', `INTAKE_${outcome.reason}`, started, ctx);
  }
  const correlationId = outcome.fingerprint;
  const log = TransitionLog.open(null, () => new Date(ctx.now()));
  const result = await processInvoice(
    { correlationId, outcome },
    {
      model: client.client,
      evidence: ctx.set.evidence,
      suppliers: ctx.set.suppliers,
      log,
      policyVersion: '2026-11-10.1',
      now: () => new Date(ctx.now()),
      newAttemptId: () => randomUUID(),
      warden: null,
      signer: null,
      alreadyClearedElsewhere: (key) => ctx.cleared.has(key),
    },
  );
  if (result.finalState === 'WARDEN_ELIGIBLE' && result.obligationKey !== null) {
    ctx.cleared.add(result.obligationKey);
  }
  return {
    decision: result.finalState === 'WARDEN_ELIGIBLE' ? 'ELIGIBLE' : 'HOLD',
    code: result.reasonCode,
    verified: result.verified,
    modelCalls: client.stats.calls,
    failures: client.stats.failures,
    inChars: client.stats.inChars,
    outChars: client.stats.outChars,
    latencyMs: ctx.now() - started,
    route: null,
  };
}

/** The swarm arm: the invoice graph, stopped at eligibility, with real reviewers and the judge. */
export async function runSwarm(
  item: LabelledCase,
  client: Meter,
  ctx: ArmContext,
): Promise<ArmResult> {
  client.reset();
  const started = ctx.now();
  const path = `${ctx.set.dir}/${item.file}`;
  const outcome = await intakeFile(path);
  if (outcome.kind !== 'text-pdf') {
    return emptyResult('HOLD', `INTAKE_${outcome.reason}`, started, ctx);
  }
  const fingerprint = outcome.fingerprint;
  const deps: GraphDeps = {
    client: client.client,
    checkpoints: new MemoryCheckpointStore(),
    mode: 'eligibility',
    policyVersion: '2026-11-10.1',
    evidence: ctx.set.evidence,
    suppliers: ctx.set.suppliers,
    alreadyPaid: (key) => ctx.cleared.has(key),
    buyerRecords: () => buyerRecordsFor(ctx.set, fingerprint),
    // The labelled set has no sender headers and no payment history, so these two checks are not evaluated here.
    // The sender check is passed by the harness and stated as a limitation in the report.
    senderCheck: () => 'PASS',
    priorHolds: () => 0,
    poAmountMinor: () => {
      const invoice = ctx.set.evidence.invoice(fingerprint);
      const poId = invoice?.purchaseOrderId ?? null;
      const po = poId === null ? undefined : ctx.set.evidence.purchaseOrder(poId);
      return po === undefined ? null : po.amountMinor;
    },
    now: ctx.now,
  };
  const correlation = outcome.fingerprint;
  const result = await runInvoice({ correlationId: correlation, outcome }, deps);
  const cleared =
    result.terminal === 'eligible' && result.data.match?.ok === true
      ? result.data.match.obligationKey
      : null;
  if (cleared !== null) {
    ctx.cleared.add(cleared);
  }
  const calls = result.budget.initial + result.budget.repair;
  return {
    decision: result.terminal === 'eligible' ? 'ELIGIBLE' : 'HOLD',
    code: result.finalCode,
    verified: result.data.verified,
    modelCalls: calls,
    failures: client.stats.failures,
    inChars: client.stats.inChars,
    outChars: client.stats.outChars,
    latencyMs: ctx.now() - started,
    route: result.route?.ruleId ?? null,
  };
}

function emptyResult(decision: 'HOLD', code: string, started: number, ctx: ArmContext): ArmResult {
  return {
    decision,
    code,
    verified: null,
    modelCalls: 0,
    failures: 0,
    inChars: 0,
    outChars: 0,
    latencyMs: ctx.now() - started,
    route: null,
  };
}
