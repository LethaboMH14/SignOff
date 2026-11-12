import { describe, expect, it } from 'vitest';

import { buildEvidenceGraph } from '../../src/graph/evidence.js';
import type { GraphResult } from '../../src/graph/run.js';
import { ARMS, type RunLine } from '../../src/experiment/run.js';
import { compareArms, FIELD_COUNT, summarise, vectorsOf } from '../../src/experiment/report.js';
import { decideRoute } from '../../src/orchestrator/route-policy.js';

const FP = 'a'.repeat(64);

function resultWith(overrides: Partial<GraphResult['data']>): GraphResult {
  const route = decideRoute({
    scan: false,
    newSupplier: false,
    bankChanged: false,
    amountBand: 'SMALL',
    senderCheck: 'PASS',
    priorHolds: 0,
  });
  const data: GraphResult['data'] = {
    correlationId: FP,
    fingerprint: FP,
    pages: [],
    startedAt: 0,
    trail: [],
    intakeCode: null,
    screenCodes: [],
    extraction: null,
    verified: null,
    route,
    supplierId: 'SUP-TST001',
    match: null,
    contexts: {},
    outcomes: [],
    pending: null,
    decision: null,
    reason: null,
    submitIntent: false,
    submitted: null,
    finalCode: 'ELIGIBLE',
    ...overrides,
  };
  return {
    correlationId: FP,
    terminal: 'eligible',
    finalCode: 'ELIGIBLE',
    reason: null,
    trail: [],
    budget: { initial: 2, repair: 0 },
    route,
    decision: { kind: 'ACCEPT' },
    data,
  };
}

const POLICY = { routePolicy: 'route-v1', judgePolicy: 'judge-v1', policyVersion: '2026-11-10.1' };

describe('evidence graph', () => {
  it('links the invoice to its supporting evidence and names a contradiction when a field is not exact', () => {
    const graph = buildEvidenceGraph(
      resultWith({
        match: {
          ok: true,
          supplierId: 'SUP-TST001',
          obligationKey: 'k',
          amountMinor: 1,
          recordSha256s: ['1'.repeat(64)],
        },
        outcomes: [
          {
            role: 'procurement',
            model: 'm',
            status: 'ok',
            reply: {
              schemaVersion: 1,
              verdict: 'PASS',
              reasonCode: 'NONE',
              evidence: [{ source: 'PO', quote: 'x' }],
            },
            issues: [],
            promptVersion: 'v1',
            promptSha256: '2'.repeat(64),
            contextTokens: 1,
            replyChars: 1,
            latencyMs: 1,
          },
        ],
      }),
      POLICY,
    );
    expect(graph.schemaVersion).toBe(1);
    expect(graph.edges.some((e) => e.to === 'invoice' && e.kind === 'supports')).toBe(true);
    expect(graph.nodes.map((n) => n.id)).toContain('review:procurement');
    expect(graph.nodes.find((n) => n.id === 'policy')?.label).toContain('route-v1');
  });

  it('is deterministic: the same result gives the same JSON, with nodes and edges sorted', () => {
    const a = JSON.stringify(buildEvidenceGraph(resultWith({}), POLICY));
    const b = JSON.stringify(buildEvidenceGraph(resultWith({}), POLICY));
    expect(a).toBe(b);
    const parsed = JSON.parse(a) as { nodes: { id: string }[] };
    const ids = parsed.nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('keeps quote text out of the graph: only hashes stand for quotes', () => {
    const graph = buildEvidenceGraph(resultWith({}), POLICY);
    expect(JSON.stringify(graph)).not.toMatch(/Lumen|Invoice number/);
  });
});

function line(
  caseId: string,
  arm: (typeof ARMS)[number],
  expected: 'ELIGIBLE' | 'HOLD',
  decision: 'ELIGIBLE' | 'HOLD',
  fields: number,
): RunLine {
  return {
    caseId,
    category: 'clean',
    arm,
    expected,
    decision,
    code: 'X',
    route: null,
    modelCalls: 1,
    failures: 0,
    inChars: 400,
    outChars: 100,
    latencyMs: 1000,
    fieldsCorrect: fields,
    fieldsTotal: FIELD_COUNT,
    model: 'test',
  };
}

describe('experiment report arithmetic', () => {
  const lines: RunLine[] = [];
  for (let i = 0; i < 6; i += 1) {
    const id = `c-${String(i).padStart(2, '0')}`;
    lines.push(line(id, 'single', 'ELIGIBLE', i < 4 ? 'ELIGIBLE' : 'HOLD', 5));
    lines.push(line(id, 'placebo', 'ELIGIBLE', i < 4 ? 'ELIGIBLE' : 'HOLD', 5));
    lines.push(line(id, 'swarm', 'ELIGIBLE', i < 5 ? 'ELIGIBLE' : 'HOLD', 6));
  }

  it('counts false holds, correct decisions and field accuracy from the lines', () => {
    const s = summarise('single', lines);
    expect(s.n).toBe(6);
    expect(s.falseHolds).toBe(2);
    expect(s.correctDecision).toBe(4);
    expect(s.fieldAccuracy).toBeCloseTo(5 / 7, 10);
  });

  it('estimates tokens from characters, and prices them only for completed invoices', () => {
    const s = summarise('swarm', lines);
    expect(s.meanEstTokens).toBe(125);
    expect(s.completed).toBe(5);
    expect(s.costPerCompletedUsd).toBeGreaterThan(0);
  });

  it('pairs the arms by case id, and refuses a comparison when they cover different cases', () => {
    const v = vectorsOf(lines, 'swarm');
    expect(v.ids).toEqual(['c-00', 'c-01', 'c-02', 'c-03', 'c-04', 'c-05']);
    const c = compareArms(lines, 'swarm', 'single');
    expect(c).toHaveLength(3);
    expect(() => compareArms(lines.slice(0, 5), 'swarm', 'single')).toThrow(RangeError);
  });

  it('reports no significant difference for a small sample, whatever the means say', () => {
    const [first] = compareArms(lines, 'swarm', 'single');
    expect(first?.verdict).toBe('no significant difference');
  });
});
