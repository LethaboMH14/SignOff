import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContext } from '../../src/context/build.js';
import type { SourceRecord } from '../../src/context/types.js';
import { EDGES, JUDGE_EDGE, assertEdge, EdgeError } from '../../src/graph/edges.js';
import { appendDecision, GENESIS, verifyDecisionLog } from '../../src/graph/decision-log.js';
import {
  FileCheckpointStore,
  CheckpointError,
  MemoryCheckpointStore,
  type Checkpoint,
} from '../../src/graph/checkpoint.js';
import { judge, type JudgeInput } from '../../src/orchestrator/judge.js';
import {
  decideRoute,
  type RouteFacts,
  ROUTE_POLICY_VERSION,
} from '../../src/orchestrator/route-policy.js';
import { draftReason, templateFor } from '../../src/orchestrator/reasons.js';
import { unverifiedQuotes } from '../../src/orchestrator/quotes.js';
import { BudgetError, SwarmBudget } from '../../src/swarm/budget.js';
import { runReviewer, runReviewers, type ReviewOutcome } from '../../src/swarm/reviewers.js';
import { REVIEW_SCHEMAS, replySchemaOf, type ReviewReply } from '../../src/swarm/schemas.js';
import { scriptedModel, PASS_FRAUD, PASS_PROCUREMENT } from '../support/graph-world.js';

const RECORDS: SourceRecord[] = [
  {
    id: 'po',
    kind: 'PO',
    provenance: 'PO',
    text: 'Purchase order PO-TST-0001. Amount 12345.67 ZAR.',
  },
  { id: 'grn', kind: 'GRN', provenance: 'GRN', text: 'Received in full, 12345.67 ZAR.' },
  {
    id: 'verified',
    kind: 'VERIFIED_FIELD',
    provenance: 'verified',
    text: 'Invoice total: 12345.67 ZAR',
  },
  {
    id: 'payee',
    kind: 'PAYEE_EVIDENCE',
    provenance: 'payee',
    text: 'Enrolled payee account FICT-ACC-1001.',
  },
  { id: 'history', kind: 'SUPPLIER_HISTORY', provenance: 'history', text: 'No prior holds.' },
  { id: 'policy', kind: 'POLICY', provenance: 'policy', text: 'Zero tolerance.' },
];

const PROC_CTX = buildContext('procurement', RECORDS);
const FRAUD_CTX = buildContext('fraud', RECORDS);

const LIGHT = decideRoute({
  scan: false,
  newSupplier: false,
  bankChanged: false,
  amountBand: 'MEDIUM',
  senderCheck: 'PASS',
  priorHolds: 0,
});
const DEEP = decideRoute({
  scan: false,
  newSupplier: true,
  bankChanged: false,
  amountBand: 'MEDIUM',
  senderCheck: 'PASS',
  priorHolds: 0,
});

function outcome(
  role: 'procurement' | 'fraud',
  reply: ReviewReply | null,
  status: 'ok' | 'invalid' | 'failed' = reply === null ? 'invalid' : 'ok',
): ReviewOutcome {
  return {
    role,
    model: 'test',
    status,
    reply,
    issues: status === 'ok' ? [] : ['root: invalid'],
    promptVersion: 'v1',
    promptSha256: '0'.repeat(64),
    contextTokens: 1,
    replyChars: 1,
    latencyMs: 1,
  };
}

const PASS_P: ReviewReply = {
  schemaVersion: 1,
  verdict: 'PASS',
  reasonCode: 'NONE',
  evidence: [
    { source: 'PO', quote: 'Amount 12345.67 ZAR' },
    { source: 'GRN', quote: 'Received in full, 12345.67 ZAR' },
  ],
};
const PASS_F: ReviewReply = {
  schemaVersion: 1,
  verdict: 'PASS',
  reasonCode: 'NONE',
  evidence: [{ source: 'PAYEE', quote: 'Enrolled payee account FICT-ACC-1001' }],
};

function input(overrides: Partial<JudgeInput>): JudgeInput {
  return {
    route: LIGHT,
    extractionOk: true,
    extractionReason: null,
    outcomes: [outcome('procurement', PASS_P)],
    contexts: { procurement: PROC_CTX, fraud: FRAUD_CTX },
    codeChecks: { poAmountWithinTolerance: true },
    budget: { remainingInitial: 1, remainingRepair: 1 },
    elapsedMs: 10,
    ...overrides,
  };
}

describe('route policy', () => {
  it('holds without a model call when the sender check has not passed', () => {
    const route = decideRoute({
      scan: false,
      newSupplier: false,
      bankChanged: false,
      amountBand: 'SMALL',
      senderCheck: 'UNKNOWN',
      priorHolds: 0,
    });
    expect(route.route).toBe('HOLD');
    expect(route.reviewers).toEqual([]);
    expect(route.holdCode).toBe('SENDER_CHECK_NOT_PASSED');
  });

  it('sends a new supplier, a bank change, a large amount and a prior hold to the deep path', () => {
    const base: RouteFacts = {
      scan: false,
      newSupplier: false,
      bankChanged: false,
      amountBand: 'SMALL',
      senderCheck: 'PASS',
      priorHolds: 0,
    };
    expect(decideRoute({ ...base, newSupplier: true }).ruleId).toBe(
      'R3-new-supplier-or-bank-change',
    );
    expect(decideRoute({ ...base, bankChanged: true }).ruleId).toBe(
      'R3-new-supplier-or-bank-change',
    );
    expect(decideRoute({ ...base, amountBand: 'LARGE' }).ruleId).toBe('R4-large-amount');
    expect(decideRoute({ ...base, priorHolds: 2 }).ruleId).toBe('R5-prior-holds');
    expect(decideRoute({ ...base, scan: true }).ruleId).toBe('R2-scan');
  });

  it('is versioned and deterministic', () => {
    expect(ROUTE_POLICY_VERSION).toBe('route-v1');
    expect(LIGHT).toEqual(
      decideRoute({
        scan: false,
        newSupplier: false,
        bankChanged: false,
        amountBand: 'MEDIUM',
        senderCheck: 'PASS',
        priorHolds: 0,
      }),
    );
    expect(DEEP.reviewers).toEqual(['procurement', 'fraud']);
  });
});

describe('orchestrator-judge', () => {
  it('accepts when every reviewer in the route passes with verified quotes and no code disagreement', () => {
    expect(judge(input({}))).toEqual({ kind: 'ACCEPT' });
  });

  it('holds on a failed call without repairing it', () => {
    expect(judge(input({ outcomes: [outcome('procurement', null, 'failed')] }))).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_CALL_FAILED',
      role: 'procurement',
    });
  });

  it('spends the one repair on an invalid reply, and holds when no repair is left', () => {
    const invalid = input({ outcomes: [outcome('procurement', null)] });
    expect(judge(invalid).kind).toBe('REPAIR');
    expect(judge({ ...invalid, budget: { remainingInitial: 1, remainingRepair: 0 } })).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_SCHEMA_INVALID',
      role: 'procurement',
    });
  });

  it('holds an unverified quote, and repairs it while a repair is left', () => {
    const fake: ReviewReply = {
      ...PASS_P,
      evidence: [{ source: 'PO', quote: 'Amount 99999.99 ZAR' }],
    };
    expect(judge(input({ outcomes: [outcome('procurement', fake)] })).kind).toBe('REPAIR');
    expect(
      judge(
        input({
          outcomes: [outcome('procurement', fake)],
          budget: { remainingInitial: 1, remainingRepair: 0 },
        }),
      ),
    ).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_QUOTE_UNVERIFIED',
      role: 'procurement',
    });
  });

  it('holds a verdict whose reason disagrees with it', () => {
    const mismatch: ReviewReply = { ...PASS_P, reasonCode: 'PO_MISMATCH' };
    expect(
      judge(
        input({
          outcomes: [outcome('procurement', mismatch)],
          budget: { remainingInitial: 1, remainingRepair: 0 },
        }),
      ),
    ).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_INCONSISTENT_REPLY',
      role: 'procurement',
    });
  });

  it('adds the other reviewer when a light-route reviewer abstains and the initial budget allows it', () => {
    const abstain: ReviewReply = {
      schemaVersion: 1,
      verdict: 'ABSTAIN',
      reasonCode: 'INSUFFICIENT_CONTEXT',
      evidence: [{ source: 'PO', quote: 'Amount 12345.67 ZAR' }],
    };
    expect(judge(input({ outcomes: [outcome('procurement', abstain)] }))).toEqual({
      kind: 'ADD_REVIEWER',
      role: 'fraud',
    });
    expect(
      judge(
        input({
          outcomes: [outcome('procurement', abstain)],
          budget: { remainingInitial: 0, remainingRepair: 1 },
        }),
      ),
    ).toEqual({
      kind: 'HOLD',
      reasonCode: 'PROCUREMENT_INSUFFICIENT_CONTEXT',
      role: 'procurement',
    });
  });

  it('never adds a reviewer on the deep path, where both already ran', () => {
    const abstain: ReviewReply = {
      schemaVersion: 1,
      verdict: 'ABSTAIN',
      reasonCode: 'INSUFFICIENT_CONTEXT',
      evidence: [{ source: 'PO', quote: 'Amount 12345.67 ZAR' }],
    };
    const action = judge(
      input({
        route: DEEP,
        outcomes: [
          outcome('procurement', PASS_P),
          outcome('fraud', { ...PASS_F, verdict: 'ABSTAIN', reasonCode: 'INSUFFICIENT_CONTEXT' }),
        ],
        budget: { remainingInitial: 0, remainingRepair: 1 },
      }),
    );
    expect(action.kind).toBe('HOLD');
    expect(abstain.verdict).toBe('ABSTAIN');
  });

  it('holds a reviewer HOLD with that reviewer’s reason, and never overrides it', () => {
    const hold: ReviewReply = {
      schemaVersion: 1,
      verdict: 'HOLD',
      reasonCode: 'PAYEE_MISMATCH',
      evidence: [{ source: 'PAYEE', quote: 'Enrolled payee account FICT-ACC-1001' }],
    };
    expect(
      judge(
        input({
          route: DEEP,
          outcomes: [outcome('procurement', PASS_P), outcome('fraud', hold)],
          budget: { remainingInitial: 0, remainingRepair: 1 },
        }),
      ),
    ).toEqual({
      kind: 'HOLD',
      reasonCode: 'FRAUD_PAYEE_MISMATCH',
      role: 'fraud',
    });
  });

  it('holds when code says the PO amount is exceeded, even if procurement passed the invoice', () => {
    expect(judge(input({ codeChecks: { poAmountWithinTolerance: false } }))).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_REVIEWERS_DISAGREE',
      role: 'procurement',
    });
  });

  it('holds a procurement PASS that the code could not check, so an unreadable PO fails closed', () => {
    expect(judge(input({ codeChecks: { poAmountWithinTolerance: null } }))).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_CODE_CHECK_MISSING',
      role: 'procurement',
    });
  });

  it('holds when the extraction failed, and when the whole invoice took too long', () => {
    expect(judge(input({ extractionOk: false, extractionReason: 'MODEL_OUTPUT_INVALID' }))).toEqual(
      {
        kind: 'HOLD',
        reasonCode: 'MODEL_OUTPUT_INVALID',
        role: null,
      },
    );
    expect(judge(input({ elapsedMs: 999_999 }))).toEqual({
      kind: 'HOLD',
      reasonCode: 'JUDGE_LATENCY_EXCEEDED',
      role: null,
    });
  });

  it('maps every judge action to an edge that exists in the graph, and never to a payment step', () => {
    for (const kind of ['ACCEPT', 'REPAIR', 'ADD_REVIEWER', 'HOLD'] as const) {
      // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
      const target = JUDGE_EDGE[kind];
      expect(EDGES.judge).toContain(target);
    }
    expect(JUDGE_EDGE.REPAIR).toBe('review');
    expect(JUDGE_EDGE.HOLD).toBe('held');
    expect(JUDGE_EDGE.ACCEPT).toBe('warden');
  });

  it('is a pure function: the same input gives the same action', () => {
    const a = input({ outcomes: [outcome('procurement', null)] });
    expect(judge(a)).toEqual(judge(a));
  });
});

describe('quote checks', () => {
  it('accepts a quote found in the item it names, after whitespace normalisation', () => {
    expect(unverifiedQuotes(PASS_P, PROC_CTX)).toEqual([]);
  });

  it('flags a quote that is absent, and a source the reviewer was not given', () => {
    const bad: ReviewReply = {
      ...PASS_P,
      evidence: [
        { source: 'PO', quote: 'Amount 1.00 ZAR' },
        { source: 'PAYEE', quote: 'FICT' },
      ],
    };
    expect(unverifiedQuotes(bad, PROC_CTX)).toEqual([
      'evidence.0: quote_not_in_source',
      'evidence.1: source_not_in_context',
    ]);
  });
});

describe('reviewers and the swarm budget', () => {
  let model: ReturnType<typeof scriptedModel>;
  beforeEach(() => {
    model = scriptedModel({ procurement: [PASS_PROCUREMENT], fraud: [PASS_FRAUD] });
  });
  afterEach(() => undefined);

  it('runs both reviewers in parallel, each on its own context, and returns both replies', async () => {
    const budget = new SwarmBudget();
    const outcomes = await runReviewers([
      {
        role: 'procurement',
        context: PROC_CTX,
        client: model,
        budget,
        nonce: () => 'a'.repeat(24),
      },
      { role: 'fraud', context: FRAUD_CTX, client: model, budget, nonce: () => 'b'.repeat(24) },
    ]);
    expect(outcomes.map((o) => o.role)).toEqual(['fraud', 'procurement']);
    expect(outcomes.every((o) => o.status === 'ok')).toBe(true);
    expect(budget.snapshot()).toEqual({ initial: 2, repair: 0 });
  });

  it('stops a fourth initial call and a second repair, before any request is sent', () => {
    const budget = new SwarmBudget({ initial: 3, repair: 1 });
    expect(() => {
      budget.spend('initial');
    }).toThrow(BudgetError);
    expect(() => {
      budget.spend('repair');
    }).toThrow(BudgetError);
  });

  it('persists the spend before each call, so a restarted run cannot exceed the budget', () => {
    const seen: unknown[] = [];
    const budget = new SwarmBudget({ initial: 0, repair: 0 }, (snapshot) => seen.push(snapshot));
    budget.spend('initial');
    budget.spend('repair');
    expect(seen).toEqual([
      { initial: 1, repair: 0 },
      { initial: 1, repair: 1 },
    ]);
    expect(() => new SwarmBudget({ initial: 4, repair: 0 })).toThrow(RangeError);
  });

  it('marks an invalid reply by path and rule only, and never returns its text', async () => {
    const bad = scriptedModel({
      procurement: [
        '{"schemaVersion":1,"verdict":"PASS","reasonCode":"NONE","evidence":[],"confidence":0.9}',
      ],
    });
    const budget = new SwarmBudget();
    const result = await runReviewer({
      role: 'procurement',
      context: PROC_CTX,
      client: bad,
      budget,
      nonce: () => 'c'.repeat(24),
    });
    expect(result.status).toBe('invalid');
    expect(result.reply).toBeNull();
    expect(JSON.stringify(result.issues)).not.toContain('0.9');
  });

  it('reports a failed call as failed, not as a verdict', async () => {
    const down = scriptedModel({ procurement: [new Error('HTTP 429')] });
    const budget = new SwarmBudget();
    const result = await runReviewer({
      role: 'procurement',
      context: PROC_CTX,
      client: down,
      budget,
      nonce: () => 'd'.repeat(24),
    });
    expect(result.status).toBe('failed');
  });

  it('defines a strict reply schema for each reviewer, with the reason codes of that role only', () => {
    expect(
      REVIEW_SCHEMAS.procurement.safeParse({ ...PASS_P, reasonCode: 'PAYEE_MISMATCH' }).success,
    ).toBe(false);
    expect(
      REVIEW_SCHEMAS.fraud.safeParse({ ...PASS_F, reasonCode: 'PAYEE_MISMATCH' }).success,
    ).toBe(true);
    expect(replySchemaOf('fraud').name).toBe('fraud_review');
    expect(JSON.stringify(replySchemaOf('fraud').schema)).not.toContain('$schema');
  });
});

describe('reason drafts', () => {
  it('uses the fixed template when no repair slot is left, without calling the model', async () => {
    const model = scriptedModel({ reason: ['{}'] });
    const result = await draftReason({
      code: 'FRAUD_PAYEE_MISMATCH',
      client: model,
      budget: new SwarmBudget({ initial: 3, repair: 1 }),
    });
    expect(result).toEqual({ text: templateFor('FRAUD_PAYEE_MISMATCH'), source: 'template' });
    expect(model.calls.length).toBe(0);
  });

  it('keeps a model draft only if it echoes the code and does not claim approval', async () => {
    const good = JSON.stringify({
      schemaVersion: 1,
      text: 'The payee account differs from the enrolled account.',
      reasonCode: 'FRAUD_PAYEE_MISMATCH',
    });
    const approving = JSON.stringify({
      schemaVersion: 1,
      text: 'This invoice is approved to pay.',
      reasonCode: 'FRAUD_PAYEE_MISMATCH',
    });
    const wrongCode = JSON.stringify({
      schemaVersion: 1,
      text: 'Looks fine.',
      reasonCode: 'PRIOR_HOLD',
    });
    expect(
      (
        await draftReason({
          code: 'FRAUD_PAYEE_MISMATCH',
          client: scriptedModel({ reason: [good] }),
          budget: new SwarmBudget(),
        })
      ).source,
    ).toBe('model');
    expect(
      (
        await draftReason({
          code: 'FRAUD_PAYEE_MISMATCH',
          client: scriptedModel({ reason: [approving] }),
          budget: new SwarmBudget(),
        })
      ).source,
    ).toBe('template');
    expect(
      (
        await draftReason({
          code: 'FRAUD_PAYEE_MISMATCH',
          client: scriptedModel({ reason: [wrongCode] }),
          budget: new SwarmBudget(),
        })
      ).source,
    ).toBe('template');
  });
});

describe('the graph edges and the logs', () => {
  it('refuses a move that is not an edge, such as a jump from the judge to a payment', () => {
    expect(() => {
      assertEdge('judge', 'submit');
    }).toThrow(EdgeError);
    expect(() => {
      assertEdge('review', 'warden');
    }).toThrow(EdgeError);
    expect(() => {
      assertEdge('judge', 'warden');
    }).not.toThrow();
  });

  it('refuses a damaged checkpoint file rather than resuming from nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-g-cp-'));
    try {
      const store = new FileCheckpointStore(dir);
      const id = 'e'.repeat(64);
      const cp: Checkpoint = {
        seq: 1,
        node: 'classify',
        phase: 'done',
        budget: { initial: 0, repair: 0 },
        data: {},
      };
      store.save(id, cp);
      expect(store.latest(id)?.node).toBe('classify');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
      writeFileSync(join(dir, id, '000001.json'), '{ not json');
      expect(() => store.latest(id)).toThrow(CheckpointError);
      expect(() => store.latest('nothex')).toThrow(CheckpointError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the decision log in a hash chain that breaks when any line is edited', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-g-log-'));
    const path = join(dir, 'decisions.jsonl');
    try {
      const base = {
        correlationId: 'f'.repeat(64),
        terminal: 'held',
        finalCode: 'PAYEE_MISMATCH',
        trail: ['intake'],
        routePolicy: 'route-v1',
        ruleId: 'R6-default-light',
        judgePolicy: 'judge-v1',
        graphVersion: 'graph-v1',
        promptSha256: { extractor: '1'.repeat(64) },
        models: ['test:model'],
        modelCalls: 2,
      };
      appendDecision(path, base);
      appendDecision(path, { ...base, terminal: 'eligible', finalCode: 'ELIGIBLE' });
      expect(verifyDecisionLog(path)).toEqual({ ok: true, brokenAt: null });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      const first = JSON.parse(lines[0] ?? '{}') as { prevSha256: string };
      expect(first.prevSha256).toBe(GENESIS);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
      writeFileSync(
        path,
        (lines[0] ?? '').replace('"terminal":"held"', '"terminal":"paid"') +
          '\n' +
          (lines[1] ?? '') +
          '\n',
      );
      expect(verifyDecisionLog(path)).toEqual({ ok: false, brokenAt: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the in-memory store with the same contract as the file store', () => {
    const store = new MemoryCheckpointStore();
    store.save('a'.repeat(64), {
      seq: 1,
      node: 'intake',
      phase: 'done',
      budget: { initial: 0, repair: 0 },
      data: {},
    });
    expect(store.latest('a'.repeat(64))?.seq).toBe(1);
    expect(store.latest('b'.repeat(64))).toBeNull();
  });
});
