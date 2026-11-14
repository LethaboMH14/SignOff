import { describe, expect, it } from 'vitest';

import {
  type ResultFile,
  asResultFile,
  judgeReportOf,
  liveCheckOf,
  passedCountOf,
  simulatedCheckOf,
  testnetCheck,
} from './judge-check.js';

const stat = (count: number, n: number): ResultFile => ({
  count,
  n,
  rate: count / n,
  low: 0,
  high: 1,
});

/** A result shaped like the committed simulated one, with the fields the report reads. */
function resultOf(overrides: ResultFile = {}): ResultFile {
  return {
    mode: 'simulated',
    generatedAt: '2026-11-10T20:29:12.567Z',
    policyVersion: '2026-11-10.1',
    model: 'simulated (rule-based stand-in)',
    pipeline: { decisionAccuracy: stat(30, 30), falseApprovals: stat(0, 16) },
    baseline: { decisionAccuracy: stat(17, 30), falseApprovals: stat(13, 16) },
    runs: [{ id: 'clean-01' }],
    ...overrides,
  };
}

const HEADLINE =
  'decision accuracy 30 of 30 for the pipeline and 17 of 30 for the single-prompt baseline; false approvals 0 of 16 for the pipeline and 13 of 16 for the baseline';

describe('judgeReportOf', () => {
  it('writes a labelled table, one row per check in order, then a count', () => {
    const report = judgeReportOf([
      { name: 'a', status: 'PASS', label: 'SIMULATED', note: 'ok', detail: 'ok' },
      { name: 'b', status: 'READ', label: 'REAL', note: 'live', detail: 'live' },
      { name: 'c', status: 'UNVERIFIED', label: 'UNVERIFIED', note: 'not run', detail: 'not run' },
    ]);
    const row = (name: string, result: string, label: string, note: string): string =>
      `${name.padEnd(34)}${result.padEnd(12)}${label.padEnd(13)}${note}`;
    expect(report.lines).toEqual([
      'JUDGE CHECK: offline, fixture mode. No key is read and no payment is sent.',
      row('CHECK', 'RESULT', 'LABEL', 'NOTE'),
      row('a', 'PASS', 'SIMULATED', 'ok'),
      row('b', 'READ', 'REAL', 'live'),
      row('c', 'UNVERIFIED', 'UNVERIFIED', 'not run'),
      'judge check: 1 pass, 0 fail, 1 read, 1 unverified.',
    ]);
  });

  it('prints the full detail of a failed check below the table, and fails the command', () => {
    const report = judgeReportOf([
      { name: 'a', status: 'PASS', label: 'SIMULATED', note: 'ok', detail: 'ok' },
      { name: 'b', status: 'FAIL', label: 'SIMULATED', note: 'short', detail: 'long reason' },
    ]);
    expect(report.lines.at(-2)).toBe('FAILED: b. long reason');
    expect(report.exitCode).toBe(1);
  });

  it('cuts a note that is too long for its column, so the table stays on one screen', () => {
    const report = judgeReportOf([
      {
        name: 'x'.repeat(60),
        status: 'PASS',
        label: 'REAL',
        note: 'short',
        detail: 'short',
      },
    ]);
    expect(report.lines[2]?.startsWith(`${'x'.repeat(33)}~`)).toBe(true);
  });

  it('fails the command only when a check failed', () => {
    expect(
      judgeReportOf([
        { name: 'a', status: 'UNVERIFIED', label: 'UNVERIFIED', note: 'x', detail: 'x' },
      ]).exitCode,
    ).toBe(0);
    expect(
      judgeReportOf([
        { name: 'a', status: 'PASS', label: 'SIMULATED', note: 'x', detail: 'x' },
        { name: 'b', status: 'FAIL', label: 'SIMULATED', note: 'y', detail: 'y' },
      ]).exitCode,
    ).toBe(1);
  });
});

describe('passedCountOf', () => {
  it('reads the count from a passing run', () => {
    expect(passedCountOf('\n Tests  12 passed (12)\n')).toBe(12);
  });

  it('reads the passing count when some tests failed', () => {
    expect(passedCountOf('Tests  1 failed | 11 passed (12)')).toBe(11);
  });

  it('takes the last summary line', () => {
    expect(passedCountOf('Tests  2 passed (2)\nTests  5 passed (5)')).toBe(5);
  });

  it('is null when the output has no summary line', () => {
    expect(passedCountOf('no summary here')).toBeNull();
  });
});

describe('simulatedCheckOf', () => {
  it('is UNVERIFIED when no result is committed on the branch', () => {
    expect(simulatedCheckOf(null, resultOf()).status).toBe('UNVERIFIED');
  });

  it('fails when the re-run wrote no result', () => {
    const check = simulatedCheckOf(resultOf(), null);
    expect(check.status).toBe('FAIL');
    expect(check.detail).toBe('SIMULATED re-run wrote no result');
  });

  it('passes when the re-run matches, whatever time it was generated', () => {
    const check = simulatedCheckOf(
      resultOf(),
      resultOf({ generatedAt: '2026-11-11T09:00:00.000Z' }),
    );
    expect(check.status).toBe('PASS');
    expect(check.detail).toBe(`SIMULATED re-run matches the committed result: ${HEADLINE}`);
  });

  it('fails and names every field that differs', () => {
    const check = simulatedCheckOf(
      resultOf(),
      resultOf({ policyVersion: '2026-11-11.1', model: 'other', runs: [{ id: 'other-01' }] }),
    );
    expect(check.status).toBe('FAIL');
    expect(check.detail).toBe(
      'SIMULATED re-run differs from the committed result in policy version, model, per-case runs',
    );
  });
});

describe('liveCheckOf', () => {
  it('is UNVERIFIED and names the file when it is not on this branch', () => {
    const check = liveCheckOf(
      'live labelled set, Groq',
      null,
      'apps/agent/results/live-groq/live-eval.json',
    );
    expect(check.status).toBe('UNVERIFIED');
    expect(check.detail).toBe(
      'not on this branch (apps/agent/results/live-groq/live-eval.json), so it is not read here',
    );
  });

  it('reads a committed live result without re-running it, and labels it REAL', () => {
    const check = liveCheckOf(
      'live labelled set, Groq',
      resultOf({ mode: 'live', model: 'groq:openai/gpt-oss-120b' }),
      'file.json',
    );
    expect(check.status).toBe('READ');
    expect(check.label).toBe('REAL');
    expect(check.detail).toBe(
      `REAL result from groq:openai/gpt-oss-120b, generated 2026-11-10T20:29:12.567Z: ${HEADLINE}`,
    );
  });

  it('labels a simulated file SIMULATED and reports what it cannot read', () => {
    const check = liveCheckOf('x', resultOf({ pipeline: {}, baseline: {} }), 'file.json');
    expect(check.label).toBe('SIMULATED');
    expect(check.detail.startsWith('SIMULATED result from simulated (rule-based stand-in)')).toBe(
      true,
    );
    expect(check.detail).toContain('decision accuracy not readable for the pipeline');
  });

  it('labels a file with no mode UNVERIFIED and fills in missing fields', () => {
    const check = liveCheckOf('x', { pipeline: {}, baseline: {} }, 'file.json');
    expect(check.label).toBe('UNVERIFIED');
    expect(check.detail).toBe(
      'UNVERIFIED result from an unknown model, generated at an unknown time: decision accuracy not readable for the pipeline and not readable for the single-prompt baseline; false approvals not readable for the pipeline and not readable for the baseline',
    );
  });

  it('does not read a count that is not a number', () => {
    const check = liveCheckOf(
      'x',
      resultOf({ pipeline: { decisionAccuracy: { count: 'x', n: 3 } } }),
      'file.json',
    );
    expect(check.detail).toContain('decision accuracy not readable for the pipeline');
  });
});

describe('asResultFile', () => {
  it('keeps a JSON object and refuses anything else', () => {
    expect(asResultFile({ mode: 'live' })).toEqual({ mode: 'live' });
    expect(asResultFile([1])).toBeNull();
    expect(asResultFile('text')).toBeNull();
    expect(asResultFile(null)).toBeNull();
  });
});

describe('testnetCheck', () => {
  it('is UNVERIFIED and never reports a Testnet payment as passed', () => {
    const check = testnetCheck();
    expect(check.status).toBe('UNVERIFIED');
    expect(check.detail).toContain('not run offline');
  });
});
