import { describeRate } from './metrics.js';
import { byCategory, type CaseRun, type Side } from './run.js';
import { ALPHA, BOOTSTRAP_ITERATIONS, type Comparison } from './stats.js';

/**
 * The evaluation report, as Markdown. The mode is printed at the top of the report and in its title. A fixture run
 * says that no language model was called, so its numbers can never be read as a model result.
 */

export interface ReportInput {
  readonly mode: 'FIXTURE' | 'LIVE';
  readonly pipelineModel: string;
  readonly baselineModel: string;
  readonly policyVersion: string;
  readonly generatedAt: string;
  readonly notice: string;
  readonly runs: readonly CaseRun[];
  readonly pipeline: Side;
  readonly baseline: Side;
  readonly comparisons: readonly Comparison[];
}

const MODE_TEXT: Readonly<Record<ReportInput['mode'], string>> = {
  FIXTURE:
    'FIXTURE. No language model was called. The stand-ins are fixed rules that read the labelled layout. These figures test the agent’s code checks and the harness only. They are not a measurement of any model, and the model benefit is unverified.',
  LIVE: 'LIVE. The models named below were called through their providers, once per invoice, with the fictional labelled set. One run is a single sample, so the intervals are wide.',
};

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

function row(label: string, pipeline: string, baseline: string): string {
  return `| ${label} | ${pipeline} | ${baseline} |`;
}

function comparisonRow(item: Comparison): string {
  const gates = `${item.gateMannWhitney ? 'pass' : 'fail'} / ${item.gateInterval ? 'pass' : 'fail'}`;
  return `| ${item.measure} | ${String(item.n)} | ${pct(item.pipelineMean)} | ${pct(item.baselineMean)} | ${(item.meanDifference * 100).toFixed(1)} pp (95% CI ${(item.ciLow * 100).toFixed(1)} to ${(item.ciHigh * 100).toFixed(1)}) | ${item.pValue.toFixed(4)} | ${item.delta.toFixed(3)} (${item.magnitude}) | ${gates} | ${item.verdict} |`;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];
  const maxCalls = Math.max(0, ...input.runs.map((run) => run.pipeline.modelCalls));
  lines.push(`# Agent evaluation: ${input.mode}`, '');
  lines.push(`> ${MODE_TEXT[input.mode]}`, '');
  lines.push(`- Generated: ${input.generatedAt}`);
  lines.push(`- Policy version: ${input.policyVersion}`);
  lines.push(`- Pipeline model: ${input.pipelineModel}`);
  lines.push(`- Baseline model: ${input.baselineModel}`);
  lines.push(`- Cases: ${String(input.runs.length)} (labelled set)`);
  lines.push(`- Most model calls used by one case: ${String(maxCalls)} (limit 3)`);
  lines.push(`- Data notice: ${input.notice}`, '');

  lines.push('## Results', '');
  lines.push('| Measure | Pipeline (agent) | Single-prompt baseline |', '| --- | --- | --- |');
  lines.push(
    row(
      'False approvals (critical; expected HOLD, decided ELIGIBLE)',
      describeRate(input.pipeline.falseApprovals),
      describeRate(input.baseline.falseApprovals),
    ),
    row(
      'False holds (expected ELIGIBLE, decided HOLD)',
      describeRate(input.pipeline.falseHolds),
      describeRate(input.baseline.falseHolds),
    ),
    row(
      'Decision accuracy',
      describeRate(input.pipeline.decisionAccuracy),
      describeRate(input.baseline.decisionAccuracy),
    ),
    row(
      'Expected reason named (holds with a labelled reason)',
      describeRate(input.pipeline.reasonFound),
      'not applicable: no reasons given',
    ),
    row(
      'Field precision (values read that match the label)',
      describeRate(input.pipeline.fieldPrecision),
      describeRate(input.baseline.fieldPrecision),
    ),
    row(
      'Field recall (labelled values read correctly)',
      describeRate(input.pipeline.fieldRecall),
      describeRate(input.baseline.fieldRecall),
    ),
    row(
      'Fields invented or wrong (values read that do not match)',
      describeRate(input.pipeline.fieldWrong),
      describeRate(input.baseline.fieldWrong),
    ),
    row(
      'Correctly left empty (labels with no value)',
      describeRate(input.pipeline.emptyCorrect),
      describeRate(input.baseline.emptyCorrect),
    ),
    '',
  );

  lines.push('## Swarm against baseline: statistics', '');
  lines.push(
    `Paired over the same ${String(input.runs.length)} cases. Gates for "better": Mann-Whitney p < ${String(ALPHA)} AND a bootstrap 95% interval for the mean difference that excludes zero (${String(BOOTSTRAP_ITERATIONS)} resamples, fixed seed). Cliff's delta is reported, not gated. Any gate that fails gives "no significant difference".`,
    '',
  );
  lines.push(
    '| Measure (per case) | n | Pipeline mean | Baseline mean | Difference, pipeline minus baseline | Mann-Whitney p | Cliff’s delta | Gates (MW / CI) | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of input.comparisons) {
    lines.push(comparisonRow(item));
  }
  lines.push('');

  lines.push('## By category', '');
  lines.push(
    '| Category | Cases | Pipeline wrong decisions | Baseline wrong decisions |',
    '| --- | --- | --- | --- |',
  );
  for (const [category, counts] of byCategory(input.runs)) {
    lines.push(
      `| ${category} | ${String(counts.n)} | ${String(counts.pipelineWrong)} | ${String(counts.baselineWrong)} |`,
    );
  }
  lines.push('');

  lines.push('## Cases', '');
  lines.push(
    '| Case | Expected | Pipeline | Final state | Named reasons | Baseline | Model calls |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const run of input.runs) {
    const expected =
      run.expected.reason === null
        ? run.expected.decision
        : `${run.expected.decision} (${run.expected.reason})`;
    lines.push(
      `| ${run.id} | ${expected} | ${run.pipeline.decision} | ${run.pipeline.finalState} | ${run.pipeline.tokens.join(', ') || '-'} | ${run.baseline.decision}${run.baseline.parsed ? '' : ' (unreadable reply)'} | ${String(run.pipeline.modelCalls)} |`,
    );
  }
  lines.push('');

  lines.push('## Reading these numbers', '');
  lines.push(
    `- ${String(input.runs.length)} cases give wide intervals. Zero false approvals is not proof of zero risk; the upper limit is shown beside it.`,
    '- Injected invoices are screened before any model reads them, so the pipeline reads no fields from them. That is by design, and it lowers field recall for that category.',
    '- Duplicates are held only when their original came earlier in the set and the pipeline cleared it. The baseline has no memory of earlier cases, so it cannot see a duplicate.',
    '- The two South African and European amount layouts are held by design, because the agent cannot be sure of the amount. Real invoices in those layouts would be held too. This is a measured over-blocking risk for the target customer, not a solved problem.',
    '- The labelled set is fictional and small. It shows whether the checks work on these cases. It does not show how the agent performs on real invoices.',
    '',
  );
  return `${lines.join('\n')}\n`;
}
