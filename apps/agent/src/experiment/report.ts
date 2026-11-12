import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { describeRate, rateOf } from '../eval/metrics.js';
import { compareSides, meanOf, type Comparison } from '../eval/stats.js';

import { ARMS, type Arm, type RunLine } from './run.js';

/**
 * Turns the run lines into the numbers the report quotes. All arithmetic is here, in code (doctrine 2). A comparison is
 * reported as better only when all three gates pass (compareSides: Mann-Whitney p < 0.05, bootstrap 95% CI of the paired
 * mean difference excluding zero, and Cliff's delta reported). Otherwise the verdict is "no significant difference".
 *
 * Price per million tokens is the Groq list price recorded in the ADR-0006 evidence (gpt-oss-120b, $0.15 in, $0.60 out).
 * Tokens are estimated from characters (four per token). Both are estimates, and the report labels them as such.
 */

export const PRICE_PER_TOKEN_IN = 0.15 / 1_000_000;
export const PRICE_PER_TOKEN_OUT = 0.6 / 1_000_000;
export const FIELD_COUNT = 7;

interface ArmSummary {
  readonly arm: Arm;
  readonly n: number;
  readonly expectedHold: number;
  readonly falseApprovals: number;
  readonly expectedEligible: number;
  readonly falseHolds: number;
  readonly correctDecision: number;
  readonly fieldAccuracy: number;
  readonly meanCalls: number;
  readonly meanEstTokens: number;
  readonly completed: number;
  readonly costPerCompletedUsd: number | null;
  readonly failures: number;
  readonly medianLatencyMs: number;
}

export function summarise(arm: Arm, lines: readonly RunLine[]): ArmSummary {
  const rows = lines.filter((line) => line.arm === arm);
  const holds = rows.filter((row) => row.expected === 'HOLD');
  const eligibles = rows.filter((row) => row.expected === 'ELIGIBLE');
  const falseApprovals = holds.filter((row) => row.decision === 'ELIGIBLE').length;
  const falseHolds = eligibles.filter((row) => row.decision === 'HOLD').length;
  const completed = rows.filter((row) => row.decision === 'ELIGIBLE').length;
  const cost = rows.reduce(
    (total, row) =>
      total + (row.inChars / 4) * PRICE_PER_TOKEN_IN + (row.outChars / 4) * PRICE_PER_TOKEN_OUT,
    0,
  );
  const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
  const median = latencies.length === 0 ? 0 : (latencies[Math.floor(latencies.length / 2)] ?? 0);
  return {
    arm,
    n: rows.length,
    expectedHold: holds.length,
    falseApprovals,
    expectedEligible: eligibles.length,
    falseHolds,
    correctDecision: rows.filter((row) => row.decision === row.expected).length,
    fieldAccuracy: meanOf(rows.map((row) => row.fieldsCorrect / FIELD_COUNT)),
    meanCalls: meanOf(rows.map((row) => row.modelCalls)),
    meanEstTokens: meanOf(rows.map((row) => (row.inChars + row.outChars) / 4)),
    completed,
    costPerCompletedUsd: completed === 0 ? null : cost / completed,
    failures: rows.reduce((total, row) => total + row.failures, 0),
    medianLatencyMs: median,
  };
}

/** Per-case vectors, paired by case id, so the three arms line up case by case. */
export function vectorsOf(
  lines: readonly RunLine[],
  arm: Arm,
): {
  readonly ids: readonly string[];
  readonly correct: readonly number[];
  readonly fieldAccuracy: readonly number[];
  readonly approvalSafe: readonly number[];
} {
  const rows = lines
    .filter((line) => line.arm === arm)
    .sort((a, b) => (a.caseId < b.caseId ? -1 : 1));
  return {
    ids: rows.map((row) => row.caseId),
    correct: rows.map((row) => (row.decision === row.expected ? 1 : 0)),
    fieldAccuracy: rows.map((row) => row.fieldsCorrect / FIELD_COUNT),
    approvalSafe: rows.map((row) =>
      row.expected === 'HOLD' && row.decision === 'ELIGIBLE' ? 0 : 1,
    ),
  };
}

export function compareArms(lines: readonly RunLine[], pipeline: Arm, baseline: Arm): Comparison[] {
  const a = vectorsOf(lines, pipeline);
  const b = vectorsOf(lines, baseline);
  if (a.ids.join('|') !== b.ids.join('|')) {
    throw new RangeError('the arms do not cover the same cases, so the pairing is broken');
  }
  return [
    compareSides(`${pipeline} vs ${baseline}: correct decision`, a.correct, b.correct),
    compareSides(`${pipeline} vs ${baseline}: field accuracy`, a.fieldAccuracy, b.fieldAccuracy),
    compareSides(`${pipeline} vs ${baseline}: no false approval`, a.approvalSafe, b.approvalSafe),
  ];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** The case ids where every arm has a line and no line has a provider failure. */
export function completeCases(lines: readonly RunLine[]): RunLine[] {
  const bad = new Set(lines.filter((line) => line.failures > 0).map((line) => line.caseId));
  const armsOf = new Map<string, Set<string>>();
  for (const line of lines) {
    const set = armsOf.get(line.caseId) ?? new Set<string>();
    set.add(line.arm);
    armsOf.set(line.caseId, set);
  }
  const ok = new Set(
    [...armsOf.keys()].filter((id) => !bad.has(id) && (armsOf.get(id)?.size ?? 0) === ARMS.length),
  );
  return lines.filter((line) => ok.has(line.caseId));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      'complete-cases': { type: 'boolean' },
    },
    strict: true,
  });
  const path = resolve(values.in ?? 'results/swarm/runs.jsonl');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunLine);
  // Complete-case mode keeps only cases where every arm finished with no provider failure, so arms share the same cases.
  const kept = values['complete-cases'] === true ? completeCases(lines) : lines;
  const summaries = ARMS.map((arm) => summarise(arm, kept));

  const out: string[] = [];
  out.push(
    '| Arm | Cases | False approvals (of HOLD-expected) | False holds (of ELIGIBLE-expected) | Correct decision | Field accuracy (of 7) | Mean calls | Est. tokens (mean) | Cost per completed invoice (est., USD) | Provider failures | Median latency (ms) |',
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of summaries) {
    out.push(
      `| ${s.arm} | ${String(s.n)} | ${describeRate(rateOf(s.falseApprovals, s.expectedHold))} | ${describeRate(rateOf(s.falseHolds, s.expectedEligible))} | ${describeRate(rateOf(s.correctDecision, s.n))} | ${pct(s.fieldAccuracy)} | ${s.meanCalls.toFixed(2)} | ${s.meanEstTokens.toFixed(0)} | ${s.costPerCompletedUsd === null ? 'no completed invoice' : s.costPerCompletedUsd.toFixed(6)} | ${String(s.failures)} | ${String(s.medianLatencyMs)} |`,
    );
  }
  out.push('');
  out.push(
    '| Comparison | n | Mean difference (pipeline minus baseline) | 95% CI | Mann-Whitney p | Cliff delta | Verdict |',
  );
  out.push('|---|---|---|---|---|---|---|');
  for (const [pipeline, baseline] of [
    ['swarm', 'single'],
    ['placebo', 'single'],
  ] as const) {
    for (const c of compareArms(kept, pipeline, baseline)) {
      out.push(
        `| ${c.measure} | ${String(c.n)} | ${c.meanDifference.toFixed(4)} | [${c.ciLow.toFixed(4)}, ${c.ciHigh.toFixed(4)}] | ${c.pValue.toFixed(4)} | ${c.delta.toFixed(3)} (${c.magnitude}) | ${c.verdict} |`,
      );
    }
  }
  const text = out.join('\n') + '\n';
  process.stdout.write(text);
  if (values.out !== undefined) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
    writeFileSync(resolve(values.out), text, 'utf8');
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
