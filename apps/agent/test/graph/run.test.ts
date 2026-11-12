import { describe, expect, it } from 'vitest';

import {
  LongTermFacts,
  recordValidatedOutcome,
  validateOutcome,
} from '../../src/context/memory.js';
import { MemoryCheckpointStore } from '../../src/graph/checkpoint.js';
import {
  resumeInvoice,
  runInvoice,
  SimulatedCrash,
  type PaymentPort,
} from '../../src/graph/run.js';
import {
  ABSTAIN_PROCUREMENT,
  graphDeps,
  HOLD_FRAUD_PAYEE,
  PASS_FRAUD,
  PASS_PROCUREMENT,
  scriptedModel,
} from '../support/graph-world.js';
import { FP, intakeOk } from '../support/world.js';

/** Model calls counted by role, from the scripted model's record. */
function callsByRole(model: { calls: { role: string }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const call of model.calls) {
    out[call.role] = (out[call.role] ?? 0) + 1;
  }
  return out;
}

const PAID_PAYMENTS = (
  order: string[],
  submitLog: { count: number } = { count: 0 },
): PaymentPort => ({
  warden: () => {
    order.push('warden');
    return Promise.resolve('APPROVED' as const);
  },
  sign: () => {
    order.push('sign');
    return Promise.resolve(true);
  },
  submit: () => {
    order.push('submit');
    submitLog.count += 1;
    return Promise.resolve({ ok: true as const, ledgerHash: 'd'.repeat(64) });
  },
  reconcile: () => {
    order.push('reconcile');
    return Promise.resolve('PAID' as const);
  },
});

describe('the invoice graph: routing and reviewers', () => {
  it('runs a known supplier on the light path: extractor and procurement only, then eligible', async () => {
    const model = scriptedModel({ procurement: [PASS_PROCUREMENT] });
    const result = await runInvoice({ correlationId: FP, outcome: intakeOk() }, graphDeps(model));

    expect(result.terminal).toBe('eligible');
    expect(result.route?.ruleId).toBe('R6-default-light');
    expect(callsByRole(model)).toEqual({ extractor: 1, procurement: 1 });
    expect(result.trail).toEqual([
      'intake',
      'classify',
      'extract',
      'verify',
      'route',
      'match',
      'review',
      'judge',
      'warden',
    ]);
  });

  it('runs both reviewers on the deep path when the priorHolds rule fires', async () => {
    const model = scriptedModel({ procurement: [PASS_PROCUREMENT], fraud: [PASS_FRAUD] });
    const result = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(model, { priorHolds: 1 }),
    );
    expect(result.route?.ruleId).toBe('R5-prior-holds');
    expect(result.terminal).toBe('eligible');
    expect(callsByRole(model)).toEqual({ extractor: 1, procurement: 1, fraud: 1 });
    expect(result.budget).toEqual({ initial: 3, repair: 0 });
  });

  it('holds on a fraud HOLD from the deep path, with the fraud reason code', async () => {
    const model = scriptedModel({ procurement: [PASS_PROCUREMENT], fraud: [HOLD_FRAUD_PAYEE] });
    const result = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(model, { priorHolds: 1 }),
    );
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('FRAUD_PAYEE_MISMATCH');
    expect(result.reason?.source).toBe('template');
  });

  it('adds the fraud reviewer when the light-path procurement reviewer abstains, but a PASS from it does not clear the abstention', async () => {
    // The fraud reviewer cannot answer the procurement question (PO and GRN agreement), so its PASS is not enough.
    const model = scriptedModel({ procurement: [ABSTAIN_PROCUREMENT], fraud: [PASS_FRAUD] });
    const result = await runInvoice({ correlationId: FP, outcome: intakeOk() }, graphDeps(model));
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('PROCUREMENT_INSUFFICIENT_CONTEXT');
    // The hold drafts a reason with the one spare repair slot; the scripted model has no draft, so the template is used.
    expect(callsByRole(model)).toEqual({ extractor: 1, procurement: 1, fraud: 1, reason: 1 });
    expect(result.budget).toEqual({ initial: 3, repair: 1 });
    expect(result.reason?.source).toBe('template');
  });

  it('lets the added fraud reviewer surface a hold when the light-path procurement reviewer abstains', async () => {
    const model = scriptedModel({ procurement: [ABSTAIN_PROCUREMENT], fraud: [HOLD_FRAUD_PAYEE] });
    const result = await runInvoice({ correlationId: FP, outcome: intakeOk() }, graphDeps(model));
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('FRAUD_PAYEE_MISMATCH');
  });

  it('spends the one repair on an invalid reply and then accepts', async () => {
    const model = scriptedModel({ procurement: ['not json at all', PASS_PROCUREMENT] });
    const result = await runInvoice({ correlationId: FP, outcome: intakeOk() }, graphDeps(model));
    expect(result.terminal).toBe('eligible');
    expect(result.budget.repair).toBe(1);
    expect(callsByRole(model)['procurement']).toBe(2);
  });

  it('holds when the one repair also fails, and never makes a further call', async () => {
    const model = scriptedModel({ procurement: ['not json', 'still not json'] });
    const result = await runInvoice({ correlationId: FP, outcome: intakeOk() }, graphDeps(model));
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('JUDGE_SCHEMA_INVALID');
    expect(result.budget).toEqual({ initial: 2, repair: 1 });
    expect(callsByRole(model)['procurement']).toBe(2);
  });

  it('holds an unverified quote rather than trusting the reviewer', async () => {
    const fabricated = JSON.stringify({
      schemaVersion: 1,
      verdict: 'PASS',
      reasonCode: 'NONE',
      evidence: [{ source: 'PO', quote: 'Amount 99999.99 ZAR' }],
    });
    const result = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(scriptedModel({ procurement: [fabricated, fabricated] })),
    );
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('JUDGE_QUOTE_UNVERIFIED');
  });

  it('refuses a reply that tries to write memory or to report confidence', async () => {
    const withMemory = JSON.stringify({
      schemaVersion: 1,
      verdict: 'PASS',
      reasonCode: 'NONE',
      evidence: [{ source: 'PO', quote: 'Amount 12345.67 ZAR' }],
      memory: { supplierId: 'SUP-TST001', outcome: 'PAID' },
    });
    const withConfidence = JSON.stringify({
      schemaVersion: 1,
      verdict: 'PASS',
      reasonCode: 'NONE',
      evidence: [{ source: 'PO', quote: 'Amount 12345.67 ZAR' }],
      confidence: 0.99,
    });
    const result = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(scriptedModel({ procurement: [withMemory, withConfidence] })),
    );
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('JUDGE_SCHEMA_INVALID');
  });

  it('holds when the sender check is unknown, without calling a reviewer', async () => {
    const model = scriptedModel({});
    const result = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(model, { senderCheck: 'UNKNOWN' }),
    );
    expect(result.terminal).toBe('held');
    expect(result.finalCode).toBe('SENDER_CHECK_NOT_PASSED');
    expect(callsByRole(model)).toEqual({ extractor: 1 });
  });

  it('refuses an intake that has no text layer, with the intake reason', async () => {
    const result = await runInvoice(
      {
        correlationId: FP,
        outcome: { kind: 'held', fingerprint: FP, bytes: 10, reason: 'NO_TEXT_LAYER' },
      },
      graphDeps(scriptedModel({})),
    );
    expect(result.terminal).toBe('refused');
    expect(result.finalCode).toBe('INTAKE_NO_TEXT_LAYER');
  });
});

describe('the invoice graph: payment path', () => {
  it('pays only in the order Warden, sign, submit, reconcile', async () => {
    const order: string[] = [];
    const result = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(scriptedModel({ procurement: [PASS_PROCUREMENT] }), {
        mode: 'payment',
        payments: PAID_PAYMENTS(order),
      }),
    );
    expect(result.terminal).toBe('paid');
    expect(order).toEqual(['warden', 'sign', 'submit', 'reconcile']);
  });
});

describe('checkpoints, kill and resume', () => {
  it('resumes a run killed after a checkpoint and reaches the same terminal, within the call budget', async () => {
    const clean = await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(scriptedModel({ procurement: [PASS_PROCUREMENT] })),
    );

    const store = new MemoryCheckpointStore();
    const firstModel = scriptedModel({ procurement: [PASS_PROCUREMENT] });
    await expect(
      runInvoice(
        { correlationId: FP, outcome: intakeOk() },
        graphDeps(firstModel, { checkpoints: store, crashAfterCheckpoints: 4 }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);

    const secondModel = scriptedModel({ procurement: [PASS_PROCUREMENT] });
    const resumed = await resumeInvoice(FP, graphDeps(secondModel, { checkpoints: store }));

    expect(resumed.terminal).toBe(clean.terminal);
    expect(resumed.finalCode).toBe(clean.finalCode);
    expect(firstModel.calls.length + secondModel.calls.length).toBeLessThanOrEqual(4);
  });

  it('does not send a payment again when the process dies during submit', async () => {
    const order: string[] = [];
    const submitLog = { count: 0 };
    const payments: PaymentPort = {
      ...PAID_PAYMENTS(order, submitLog),
      submit: () => {
        submitLog.count += 1;
        // The process dies while the ledger call is in flight: no result is written.
        return Promise.reject(new SimulatedCrash());
      },
    };
    const store = new MemoryCheckpointStore();
    await expect(
      runInvoice(
        { correlationId: FP, outcome: intakeOk() },
        graphDeps(scriptedModel({ procurement: [PASS_PROCUREMENT] }), {
          mode: 'payment',
          payments,
          checkpoints: store,
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);

    const last = store.latest(FP);
    expect(last?.phase).toBe('intent');
    const resumed = await resumeInvoice(
      FP,
      graphDeps(scriptedModel({}), { mode: 'payment', payments, checkpoints: store }),
    );
    expect(resumed.terminal).toBe('needs-person');
    expect(resumed.finalCode).toBe('SUBMIT_OUTCOME_UNKNOWN');
    expect(submitLog.count).toBe(1);
  });

  it('writes a checkpoint at every transition, in sequence order', async () => {
    const store = new MemoryCheckpointStore();
    await runInvoice(
      { correlationId: FP, outcome: intakeOk() },
      graphDeps(scriptedModel({ procurement: [PASS_PROCUREMENT] }), { checkpoints: store }),
    );
    const seqs = store.all(FP).map((cp) => cp.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(store.latest(FP)?.node).toBe('eligible');
  });
});

describe('long-term facts', () => {
  it('records a validated outcome through the code-only writer, and never mutates an earlier store', () => {
    const before = LongTermFacts.empty();
    const outcome = validateOutcome({
      supplierId: 'SUP-TST001',
      invoiceFingerprint: FP,
      outcome: 'HELD',
      reasonCode: 'PAYEE_MISMATCH',
      policyVersion: '2026-11-10.1',
      logLineSha256: 'e'.repeat(64),
    });
    const after = recordValidatedOutcome(before, outcome);
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
    expect(after.historyOf('SUP-TST001')[0]?.outcome).toBe('HELD');
  });
});
