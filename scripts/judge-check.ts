// The judge check. One command, from the repository root: npm run judge:check
// Offline by default. It runs the payment tests and the injection (attack) tests, re-runs the simulated labelled set into a
// temporary folder and compares it with the committed result, and reads the live results committed on this branch.
// It submits no payment, reads no keys and calls no model. Testnet payments are reported as UNVERIFIED. The rules for the
// report are in scripts/lib/judge-check.ts.
/* eslint-disable security/detect-non-literal-fs-filename -- the judge check reads the result files it names */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type JudgeCheck,
  type ResultFile,
  asResultFile,
  judgeReportOf,
  liveCheckOf,
  passedCountOf,
  simulatedCheckOf,
  testnetCheck,
} from './lib/judge-check.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const RESULTS_DIR = 'apps/agent/results';
const RESULTS = join(ROOT, RESULTS_DIR);
const PAYMENT_TESTS = ['packages/xrpl/test/payments.test.ts', 'apps/warden/test/payment.test.ts'];
const INJECTION_TESTS = ['apps/agent/test/screen/injection.test.ts'];
const LIVE_RUNS = [
  { name: 'live labelled set, Groq', folder: 'live-groq' },
  { name: 'live labelled set, Gemini', folder: 'live-gemini' },
  { name: 'live labelled set, OpenRouter', folder: 'live-openrouter' },
];

/** Reads a committed result file. A missing file is null; a file that is not JSON fails the run. */
function readResult(path: string): ResultFile | null {
  return existsSync(path) ? asResultFile(JSON.parse(readFileSync(path, 'utf8')) as unknown) : null;
}

interface TestRun {
  readonly status: number | null;
  readonly output: string;
}

/** Runs the named test files with vitest, the runner behind `npm test`, directly and without a shell. */
function runTests(files: readonly string[]): TestRun {
  const run = spawnSync(process.execPath, [VITEST, 'run', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

/**
 * Runs a set of test files on a fake ledger or fixtures: every such row is SIMULATED, never REAL. The count is shown in
 * the note; the full output of a failed run goes to the terminal above the table.
 */
function testCheck(name: string, files: readonly string[]): JudgeCheck {
  const { status, output } = runTests(files);
  if (status !== 0) {
    // The last lines show which test failed. They go to the terminal before the report.
    process.stderr.write(`${output.split('\n').slice(-60).join('\n')}\n`);
    return {
      name,
      status: 'FAIL',
      label: 'SIMULATED',
      note: `vitest exited with ${String(status)}; output above`,
      detail: `vitest exited with ${String(status)}; its output is above`,
    };
  }
  const count = passedCountOf(output);
  const scope = `in ${String(files.length)} file(s)`;
  const passed = count === null ? `passed ${scope}` : `${String(count)} tests passed ${scope}`;
  return { name, status: 'PASS', label: 'SIMULATED', note: passed, detail: passed };
}

/** Re-runs the simulated labelled set into a temporary folder, so the committed result is never overwritten. */
function reproduceSimulated(): JudgeCheck {
  const folder = mkdtempSync(join(tmpdir(), 'signoff-judge-'));
  try {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'apps/agent/src/main.ts', 'eval', '--out', folder],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (run.status !== 0) {
      process.stderr.write(run.stderr);
    }
    const generated = run.status === 0 ? readResult(join(folder, 'simulated-eval.json')) : null;
    return simulatedCheckOf(readResult(join(RESULTS, 'simulated-eval.json')), generated);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function main(): void {
  const checks: JudgeCheck[] = [
    testCheck('payment tests (xrpl and Warden)', PAYMENT_TESTS),
    testCheck('injection (attack) tests (agent)', INJECTION_TESTS),
    reproduceSimulated(),
    ...LIVE_RUNS.map(({ name, folder }) =>
      liveCheckOf(
        name,
        readResult(join(RESULTS, folder, 'live-eval.json')),
        `${RESULTS_DIR}/${folder}/live-eval.json`,
      ),
    ),
    testnetCheck(),
  ];
  const report = judgeReportOf(checks);
  for (const line of report.lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exitCode = report.exitCode;
}

try {
  main();
} catch {
  // Only a fixed message is printed. A stack trace could show paths that do not belong on a screen.
  process.stderr.write('judge check: the run did not finish\n');
  process.exitCode = 1;
}
