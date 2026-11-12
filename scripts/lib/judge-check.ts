/**
 * The judge check's report. Each check says what ran here and what did not, in plain words. A check that did not run is
 * UNVERIFIED, never PASS, and only a check that ran and failed fails the command. Every row carries one evidence label:
 * REAL (a real model call, read from a committed result), SIMULATED (run here on fixtures or a fake ledger), or
 * UNVERIFIED (not run here). The functions are pure: the entry point (scripts/judge-check.ts) runs the tests and the
 * re-run, and reads the result files.
 */

export type CheckStatus = 'PASS' | 'FAIL' | 'READ' | 'UNVERIFIED';

/** What kind of evidence a row is. Only REAL rows came from a real provider or the real ledger. */
export type EvidenceLabel = 'REAL' | 'SIMULATED' | 'UNVERIFIED';

export interface JudgeCheck {
  /** The check's name, as the judge reads it. */
  readonly name: string;
  readonly status: CheckStatus;
  readonly label: EvidenceLabel;
  /** One short line for the table, so the report fits on one screen. */
  readonly note: string;
  /** Plain words about what happened, with the numbers that were read or produced. Printed for a failed check. */
  readonly detail: string;
}

export interface JudgeReport {
  readonly lines: readonly string[];
  readonly exitCode: 0 | 1;
}

/** A parsed result file. Its fields are read as they are; nothing here assumes the file is well formed. */
export type ResultFile = Readonly<Record<string, unknown>>;

interface Stat {
  readonly count: number;
  readonly n: number;
}

const COLUMNS = { name: 34, result: 12, label: 13 } as const;

function isRecord(value: unknown): value is ResultFile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed result, or null when the file holds something other than a JSON object. */
export function asResultFile(value: unknown): ResultFile | null {
  return isRecord(value) ? value : null;
}

function isStat(value: unknown): value is Stat {
  return isRecord(value) && typeof value['count'] === 'number' && typeof value['n'] === 'number';
}

function statText(value: unknown): string {
  return isStat(value) ? `${String(value.count)} of ${String(value.n)}` : 'not readable';
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** The label a committed result earns from its mode: a live run is REAL, a simulated one SIMULATED. */
function labelOfMode(mode: unknown): EvidenceLabel {
  if (mode === 'live') {
    return 'REAL';
  }
  return mode === 'simulated' ? 'SIMULATED' : 'UNVERIFIED';
}

/** The headline numbers of a result: the pipeline against the single-prompt baseline, in full. */
function headlineOf(result: ResultFile): string {
  const pipeline: ResultFile = isRecord(result['pipeline']) ? result['pipeline'] : {};
  const baseline: ResultFile = isRecord(result['baseline']) ? result['baseline'] : {};
  return `decision accuracy ${statText(pipeline['decisionAccuracy'])} for the pipeline and ${statText(baseline['decisionAccuracy'])} for the single-prompt baseline; false approvals ${statText(pipeline['falseApprovals'])} for the pipeline and ${statText(baseline['falseApprovals'])} for the baseline`;
}

/** The short version of the headline, for the table: the pipeline's own numbers only. */
function shortHeadlineOf(result: ResultFile): string {
  const pipeline: ResultFile = isRecord(result['pipeline']) ? result['pipeline'] : {};
  return `pipeline ${statText(pipeline['decisionAccuracy'])} correct, false approvals ${statText(pipeline['falseApprovals'])}`;
}

/** Pads a cell to a fixed width, cutting it if it is longer, so each row lines up. */
function cell(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}~` : text.padEnd(width);
}

/**
 * The table, one row per check, then a count. Only a failed check fails the command. A failed check's full detail is
 * printed below the table, so the table itself stays short enough for one screen.
 */
export function judgeReportOf(checks: readonly JudgeCheck[]): JudgeReport {
  const countOf = (status: CheckStatus): number =>
    checks.filter((check) => check.status === status).length;
  const lines: string[] = [
    'JUDGE CHECK: offline, fixture mode. No key is read and no payment is sent.',
    `${cell('CHECK', COLUMNS.name)}${cell('RESULT', COLUMNS.result)}${cell('LABEL', COLUMNS.label)}NOTE`,
    ...checks.map(
      ({ name, status, label, note }) =>
        `${cell(name, COLUMNS.name)}${cell(status, COLUMNS.result)}${cell(label, COLUMNS.label)}${note}`,
    ),
  ];
  for (const check of checks.filter((item) => item.status === 'FAIL')) {
    lines.push(`FAILED: ${check.name}. ${check.detail}`);
  }
  lines.push(
    `judge check: ${String(countOf('PASS'))} pass, ${String(countOf('FAIL'))} fail, ${String(countOf('READ'))} read, ${String(countOf('UNVERIFIED'))} unverified.`,
  );
  return { lines, exitCode: countOf('FAIL') > 0 ? 1 : 0 };
}

/** The passed count of a vitest run, from its last summary line; null when the output has none. */
export function passedCountOf(output: string): number | null {
  const summary = output
    .split('\n')
    .filter((line) => /^\s*Tests\s/.test(line))
    .at(-1);
  const count = summary?.match(/(\d+) passed/)?.[1];
  return count === undefined ? null : Number(count);
}

/**
 * Compares a fresh run of the simulated labelled set with the committed result. The run is the same code on the same
 * fixtures, so it must match in every field compared here. The time it was generated is not compared.
 */
export function simulatedCheckOf(
  committed: ResultFile | null,
  generated: ResultFile | null,
): JudgeCheck {
  const name = 'simulated labelled set (re-run)';
  if (committed === null) {
    return {
      name,
      status: 'UNVERIFIED',
      label: 'UNVERIFIED',
      note: 'no committed result on this branch to compare with',
      detail:
        'no committed simulated result on this branch, so there is nothing to compare the re-run with',
    };
  }
  if (generated === null) {
    return {
      name,
      status: 'FAIL',
      label: 'SIMULATED',
      note: 're-run wrote no result',
      detail: 'SIMULATED re-run wrote no result',
    };
  }
  const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const fields: readonly (readonly [string, boolean])[] = [
    ['mode', sameJson(committed['mode'], generated['mode'])],
    ['policy version', sameJson(committed['policyVersion'], generated['policyVersion'])],
    ['model', sameJson(committed['model'], generated['model'])],
    ['pipeline', sameJson(committed['pipeline'], generated['pipeline'])],
    ['baseline', sameJson(committed['baseline'], generated['baseline'])],
    ['per-case runs', sameJson(committed['runs'], generated['runs'])],
  ];
  const differing = fields.filter(([, same]) => !same).map(([label]) => label);
  if (differing.length > 0) {
    return {
      name,
      status: 'FAIL',
      label: 'SIMULATED',
      note: `differs from the committed result: ${differing.join(', ')}`,
      detail: `SIMULATED re-run differs from the committed result in ${differing.join(', ')}`,
    };
  }
  return {
    name,
    status: 'PASS',
    label: 'SIMULATED',
    note: `matches the committed result; ${shortHeadlineOf(committed)}`,
    detail: `SIMULATED re-run matches the committed result: ${headlineOf(committed)}`,
  };
}

/**
 * A committed live result is read and reported, never re-run: a re-run would call the model providers again, which
 * costs tokens and needs keys.
 */
export function liveCheckOf(name: string, result: ResultFile | null, file: string): JudgeCheck {
  if (result === null) {
    return {
      name,
      status: 'UNVERIFIED',
      label: 'UNVERIFIED',
      note: 'not on this branch; not read here',
      detail: `not on this branch (${file}), so it is not read here`,
    };
  }
  const label = labelOfMode(result['mode']);
  const model = textOf(result['model'], 'an unknown model');
  const generatedAt = textOf(result['generatedAt'], 'at an unknown time');
  return {
    name,
    status: 'READ',
    label,
    note: `committed, read not re-run; ${shortHeadlineOf(result)}`,
    detail: `${label} result from ${model}, generated ${generatedAt}: ${headlineOf(result)}`,
  };
}

/** The Testnet payments are not run offline. This check says so; it never reports them as passed. */
export function testnetCheck(): JudgeCheck {
  return {
    name: 'Testnet payments (live, not run)',
    status: 'UNVERIFIED',
    label: 'UNVERIFIED',
    note: 'not run offline; no payment is sent here',
    detail:
      'not run offline. This command submits no payment and reads no keys. The testnet:* commands reproduce them with the operator keys in place.',
  };
}
