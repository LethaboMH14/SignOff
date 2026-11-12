/**
 * The judge check's report. Each check says what ran here and what did not, in plain words. A check that did not run is
 * UNVERIFIED, never PASS, and only a check that ran and failed fails the command. The functions are pure: the entry point
 * (scripts/judge-check.ts) runs the tests and the re-run, and reads the result files.
 */

export type CheckStatus = 'PASS' | 'FAIL' | 'READ' | 'UNVERIFIED';

export interface JudgeCheck {
  /** The check's name, as the judge reads it. */
  readonly name: string;
  readonly status: CheckStatus;
  /** Plain words about what happened, with the numbers that were read or produced. */
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

/** The label a status is written with. A committed live result is read, not re-run, and the label says so. */
function statusLabel(status: CheckStatus): string {
  return status === 'READ' ? 'READ, NOT RE-RUN' : status;
}

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

function labelOf(mode: unknown): string {
  if (mode === 'live') {
    return 'LIVE';
  }
  return mode === 'simulated' ? 'SIMULATED' : 'UNLABELLED';
}

/** The headline numbers of a result: the pipeline against the single-prompt baseline. */
function headlineOf(result: ResultFile): string {
  const pipeline: ResultFile = isRecord(result['pipeline']) ? result['pipeline'] : {};
  const baseline: ResultFile = isRecord(result['baseline']) ? result['baseline'] : {};
  return `decision accuracy ${statText(pipeline['decisionAccuracy'])} for the pipeline and ${statText(baseline['decisionAccuracy'])} for the single-prompt baseline; false approvals ${statText(pipeline['falseApprovals'])} for the pipeline and ${statText(baseline['falseApprovals'])} for the baseline`;
}

/** Puts the checks in order, one line each, then a count. Only a failed check fails the command. */
export function judgeReportOf(checks: readonly JudgeCheck[]): JudgeReport {
  const countOf = (status: CheckStatus): number =>
    checks.filter((check) => check.status === status).length;
  const lines = checks.map(
    ({ name, status, detail }) => `${name}: ${statusLabel(status)}. ${detail}`,
  );
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
  const name = 'simulated labelled set';
  if (committed === null) {
    return {
      name,
      status: 'UNVERIFIED',
      detail:
        'no committed simulated result on this branch, so there is nothing to compare the re-run with',
    };
  }
  if (generated === null) {
    return { name, status: 'FAIL', detail: 'SIMULATED re-run wrote no result' };
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
      detail: `SIMULATED re-run differs from the committed result in ${differing.join(', ')}`,
    };
  }
  return {
    name,
    status: 'PASS',
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
      detail: `not on this branch (${file}), so it is not read here`,
    };
  }
  return {
    name,
    status: 'READ',
    detail: `${labelOf(result['mode'])} result from ${textOf(result['model'], 'an unknown model')}, generated ${textOf(result['generatedAt'], 'at an unknown time')}: ${headlineOf(result)}`,
  };
}

/** The Testnet payments are not run offline. This check says so; it never reports them as passed. */
export function testnetCheck(): JudgeCheck {
  return {
    name: 'Testnet payments',
    status: 'UNVERIFIED',
    detail:
      'not run offline. This command submits no payment and reads no keys. The testnet:* commands reproduce them with the operator keys in place.',
  };
}
