import { describeRate } from './metrics.js';
import { byCategory, type CaseRun, type Side } from './run.js';

/**
 * The evaluation report, as Markdown. The mode is printed at the top of the report and in its title. A simulated run
 * says that no language model was called, so its numbers can never be read as a model result.
 */

export interface ReportInput {
  readonly mode: 'SIMULATED' | 'LIVE';
  readonly pipelineModel: string;
  readonly baselineModel: string;
  readonly policyVersion: string;
  readonly generatedAt: string;
  readonly notice: string;
  readonly runs: readonly CaseRun[];
  readonly pipeline: Side;
  readonly baseline: Side;
}

const MODE_TEXT: Readonly<Record<ReportInput['mode'], string>> = {
  SIMULATED:
    'SIMULATED. No language model was called. The stand-ins are fixed rules that read the labelled layout. These figures test the agent’s code checks and the harness only. They are not a measurement of any model, and the model benefit is unverified.',
  LIVE: 'LIVE. The models named below were called through their providers, once per invoice, with the fictional labelled set. One run is a single sample, so the intervals are wide.',
};

function row(label: string, pipeline: string, baseline: string): string {
  return `| ${label} | ${pipeline} | ${baseline} |`;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# Agent evaluation: ${input.mode}`, '');
  lines.push(`> ${MODE_TEXT[input.mode]}`, '');
  lines.push(`- Generated: ${input.generatedAt}`);
  lines.push(`- Policy version: ${input.policyVersion}`);
  lines.push(`- Pipeline model: ${input.pipelineModel}`);
  lines.push(`- Baseline model: ${input.baselineModel}`);
  lines.push(`- Cases: ${String(input.runs.length)} (labelled set)`);
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
    '- Thirty cases give wide intervals. Zero false approvals in thirty cases is not proof of zero risk, and the upper limit is shown beside it.',
    '- Injected invoices are screened before any model reads them, so the pipeline reads no fields from them. That is by design, and it lowers field recall for that category.',
    '- The two South African and European amount layouts are held by design, because the agent cannot be sure of the amount. Real invoices in those layouts would be held too. This is a measured over-blocking risk for the target customer, not a solved problem.',
    '- The labelled set is fictional and small. It shows whether the checks work on these cases. It does not show how the agent performs on real invoices.',
    '',
  );
  return `${lines.join('\n')}\n`;
}
