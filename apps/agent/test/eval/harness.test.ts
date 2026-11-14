/* eslint-disable security/detect-non-literal-fs-filename -- reads the committed fixture folder */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import {
  CASES,
  invoiceNumberOf,
  layoutOf,
  numberIndexOf,
  SPANNED_FIELDS,
} from '../../tools/labelled-spec.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';
import { intakeFile } from '../../src/intake/intake.js';
import { loadLabelledSet, CATEGORIES } from '../../src/eval/cases.js';
import {
  byCategory,
  evaluate,
  perCaseScores,
  scoreBaseline,
  scorePipeline,
} from '../../src/eval/run.js';
import { renderReport } from '../../src/eval/report.js';
import { compareSides } from '../../src/eval/stats.js';
import { simulatedModel } from '../../src/eval/simulated-model.js';
import { AGENT_POLICY_VERSION } from '../../src/config.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/labelled', import.meta.url));
const SLOW = 240_000;

describe('the committed labelled set', () => {
  it('has sixty-two fictional cases in seven categories, and every file is present', () => {
    const set = loadLabelledSet(FIXTURES);
    expect(set.cases).toHaveLength(62);
    expect(set.notice).toContain('FICTIONAL');
    const counts = new Map<string, number>();
    for (const item of set.cases) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      clean: 14,
      messy: 10,
      injected: 10,
      missing: 8,
      'forged-payee': 8,
      'over-limit': 6,
      duplicate: 6,
    });
    expect(CATEGORIES).toHaveLength(7);
  });

  it('matches the generator, byte for byte, for every PDF', () => {
    CASES.forEach((_spec, index) => {
      const id = labelledIds().at(index) ?? '';
      const bytes = readFileSync(`${FIXTURES}/invoices/${id}.pdf`);
      expect(bytes.equals(writeTextPdf([layoutOf(index).lines]))).toBe(true);
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
    'gives every case a readable text layer, and every source span appears verbatim in it',
    async () => {
      const set = loadLabelledSet(FIXTURES);
      for (const item of set.cases) {
        const outcome = await intakeFile(`${FIXTURES}/${item.file}`);
        if (item.expected.decision === 'HOLD' && item.expected.reason === 'CURRENCY_NON_ZAR') {
          // A non-ZAR invoice is held at intake by the classifier, so it has no text to check against the spans.
          expect(outcome, item.id).toMatchObject({ kind: 'held', reason: 'CURRENCY_NON_ZAR' });
          continue;
        }
        expect(outcome.kind, item.id).toBe('text-pdf');
        if (outcome.kind !== 'text-pdf') continue;
        const text = outcome.pages.join('\n');
        for (const [field, span] of Object.entries(item.expected.spans)) {
          if (span !== null) {
            expect(text.includes(span), `${item.id} ${field}`).toBe(true);
          }
        }
        // A stated value must have a span. A field the label leaves empty must have none.
        for (const field of SPANNED_FIELDS) {
          const stated = Reflect.get(item.expected.fields, field) !== null;
          expect(Reflect.get(item.expected.spans, field) !== null, `${item.id} ${field}`).toBe(
            stated,
          );
        }
      }
    },
    SLOW,
  );

  it('uses invoice and order numbers that do not repeat, except where a duplicate reuses its original', () => {
    const numbers = CASES.map((_, index) => invoiceNumberOf(numberIndexOf(index)));
    const duplicates = CASES.filter((spec) => spec.refersTo !== undefined).length;
    expect(new Set(numbers).size).toBe(CASES.length - duplicates);
  });
});

describe('evaluation with the fixture stand-in models', () => {
  it(
    'runs every case through the fixed workflow, and labels the run as FIXTURE',
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
      expect(runs).toHaveLength(62);
      for (const run of runs) {
        expect(run.pipeline.modelCalls, run.id).toBeLessThanOrEqual(3);
      }

      const pipeline = scorePipeline(runs);
      expect(pipeline.decisionAccuracy.n).toBe(62);
      const baseline = scoreBaseline(runs);
      expect(baseline.decisionAccuracy.n).toBe(62);

      const swarm = perCaseScores(runs, 'pipeline');
      const plain = perCaseScores(runs, 'baseline');
      expect(swarm.decision).toHaveLength(62);
      expect(plain.fields).toHaveLength(62);
      const comparison = compareSides('Decision correct', swarm.decision, plain.decision);
      expect(comparison.n).toBe(62);

      const byCat = byCategory(runs);
      expect(byCat.size).toBe(7);

      const report = renderReport({
        mode: 'FIXTURE',
        pipelineModel: 'fixture',
        baselineModel: 'fixture',
        policyVersion: AGENT_POLICY_VERSION,
        generatedAt: '2026-11-10T10:00:00.000Z',
        notice: set.notice,
        runs,
        pipeline,
        baseline,
        comparisons: [comparison],
      });
      expect(report).toContain('# Agent evaluation: FIXTURE');
      expect(report).toContain('No language model was called');
      expect(report).toContain('| False approvals');
      expect(report).toContain('Mann-Whitney');
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
      comparisons: [],
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
