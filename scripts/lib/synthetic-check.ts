/**
 * The result of one read-only check in the synthetic Testnet check. A check that was not set up is "not checked", which is
 * reported as UNVERIFIED and does not fail the run. A check that ran and found a problem fails the run.
 */

export type CheckStatus = 'ok' | 'failed' | 'not-checked';

export interface CheckResult {
  readonly status: CheckStatus;
  /** Plain words about the check. Never an address, a seed or a key. */
  readonly detail: string;
}

export interface SyntheticSummary {
  /** failed when any check failed; unverified when none failed but one was not checked; ok otherwise. */
  readonly overall: 'ok' | 'failed' | 'unverified';
  readonly lines: readonly string[];
  /** The process exit code: 1 only for a failed check. */
  readonly exitCode: 0 | 1;
}

const LABEL: Readonly<Record<CheckStatus, string>> = {
  ok: 'OK',
  failed: 'FAILED',
  'not-checked': 'NOT CHECKED (UNVERIFIED)',
};

/** Puts the named checks in order and decides the overall result. The order is fixed, so the output is comparable. */
export function summarizeSynthetic(
  checks: readonly { readonly name: string; readonly result: CheckResult }[],
): SyntheticSummary {
  const lines = checks.map(
    ({ name, result }) => `${name}: ${LABEL[result.status]}. ${result.detail}`,
  );
  const statuses = checks.map(({ result }) => result.status);
  const overall = statuses.includes('failed')
    ? 'failed'
    : statuses.includes('not-checked')
      ? 'unverified'
      : 'ok';
  return { overall, lines, exitCode: overall === 'failed' ? 1 : 0 };
}
