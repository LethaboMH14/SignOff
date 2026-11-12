/* eslint-disable security/detect-non-literal-fs-filename -- reads the committed fixture folder */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import { CASES, invoiceNumberOf, linesOf } from '../../tools/labelled-spec.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';
import { intakeFile } from '../../src/intake/intake.js';
import { loadLabelledSet, CATEGORIES } from '../../src/eval/cases.js';
import { evaluate, scoreBaseline, scorePipeline, byCategory } from '../../src/eval/run.js';
import { renderReport } from '../../src/eval/report.js';
import { simulatedModel } from '../../src/eval/simulated-model.js';
import { AGENT_POLICY_VERSION } from '../../src/config.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/labelled', import.meta.url));
const SLOW = 240_000;

describe('the committed labelled set', () => {
  it('has thirty fictional cases in the five categories, and every file is present', () => {
    const set = loadLabelledSet(FIXTURES);
    expect(set.cases).toHaveLength(30);
    expect(set.notice).toContain('FICTIONAL');
    const counts = new Map<string, number>();
    for (const item of set.cases) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      clean: 10,
      messy: 6,
      injected: 6,
      missing: 4,
      'forged-payee': 4,
    });
    expect(CATEGORIES).toHaveLength(5);
  });

  it('matches the generator, byte for byte, for every PDF', () => {
    CASES.forEach((_spec, index) => {
      const id = labelledIds().at(index) ?? '';
      const bytes = readFileSync(`${FIXTURES}/invoices/${id}.pdf`);
      expect(bytes.equals(writeTextPdf([linesOf(index)]))).toBe(true);
    });
  });

  it('gives each PDF a fingerprint that the buyer evidence records', () => {
    const set = loadLabelledSet(FIXTURES);
    for (const item of set.cases) {
      const bytes = readFileSync(`${FIXTURES}/${item.file}`);
      expect(set.evidence.invoice(sha256OfBytes(bytes))).toBeDefined();
    }
  });

  it(
    'gives every case a readable text layer through the same intake the agent uses',
    async () => {
      const set = loadLabelledSet(FIXTURES);
      for (const item of set.cases) {
        const outcome = await intakeFile(`${FIXTURES}/${item.file}`);
        expect(outcome.kind, item.id).toBe('text-pdf');
      }
    },
    SLOW,
  );

  it('uses invoice and order numbers that do not repeat', () => {
    const numbers = CASES.map((_, index) => invoiceNumberOf(index));
    expect(new Set(numbers).size).toBe(CASES.length);
  });
});

describe('evaluation with the stand-in models', () => {
  it(
    'lets the pipeline approve exactly the eligible cases, and labels the run as simulated',
    async () => {
      const set = loadLabelledSet(FIXTURES);
      const runs = await evaluate({
        set,
        model: simulatedModel('extractor'),
        baselineModel: simulatedModel('baseline'),
        policyVersion: AGENT_POLICY_VERSION,
        now: () => new Date('2026-11-10T10:00:00.000Z'),
        nonce: () => 'a1b2c3d4e5f60718293a4b5c',
      });
      expect(runs).toHaveLength(30);

      const pipeline = scorePipeline(runs);
      expect(pipeline.falseApprovals.count).toBe(0);
      expect(pipeline.falseHolds.count).toBe(0);
      expect(pipeline.decisionAccuracy.count).toBe(30);
      expect(pipeline.reasonFound.count).toBe(pipeline.reasonFound.n);

      const baseline = scoreBaseline(runs);
      expect(baseline.falseApprovals.count).toBeGreaterThan(0);

      const byCat = byCategory(runs);
      expect(byCat.get('injected')).toEqual({ n: 6, pipelineWrong: 0, baselineWrong: 6 });
      expect(byCat.get('forged-payee')?.pipelineWrong).toBe(0);
      expect(byCat.get('clean')?.baselineWrong).toBe(0);

      const report = renderReport({
        mode: 'SIMULATED',
        pipelineModel: 'simulated',
        baselineModel: 'simulated',
        policyVersion: AGENT_POLICY_VERSION,
        generatedAt: '2026-11-10T10:00:00.000Z',
        notice: set.notice,
        runs,
        pipeline,
        baseline,
      });
      expect(report).toContain('# Agent evaluation: SIMULATED');
      expect(report).toContain('No language model was called');
      expect(report).toContain('| False approvals');
      expect(report).toContain('| messy-05 |');
    },
    SLOW,
  );

  it('shows a LIVE header and wording when the run used a provider', () => {
    const report = renderReport({
      mode: 'LIVE',
      pipelineModel: 'openrouter:example',
      baselineModel: 'openrouter:example',
      policyVersion: AGENT_POLICY_VERSION,
      generatedAt: '2026-11-10T10:00:00.000Z',
      notice: 'FICTIONAL TEST DATA.',
      runs: [],
      pipeline: scorePipeline([]),
      baseline: scoreBaseline([]),
    });
    expect(report).toContain('# Agent evaluation: LIVE');
    expect(report).toContain('The models named below were called');
    expect(report).toContain('0/0 (no cases)');
  });
});

/** The case identifiers in the order the generator gives them, so the test reads the same files. */
function labelledIds(): string[] {
  const counters = new Map<string, number>();
  return CASES.map((spec) => {
    const next = (counters.get(spec.category) ?? 0) + 1;
    counters.set(spec.category, next);
    return `${spec.category}-${String(next).padStart(2, '0')}`;
  });
}
