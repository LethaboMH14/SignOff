/*
 * Runs the Warden attack suite (apps/warden/test/attacks) and prints one results table.
 * Each test title is "ID | case | expected outcome". The table shows what each case expects and whether the
 * Warden did it. It runs offline, against the in-memory ledger; it is not a Testnet run.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Row {
  readonly id: string;
  readonly caseName: string;
  readonly expected: string;
  readonly passed: boolean;
}

interface JsonAssertion {
  readonly fullName?: string;
  readonly title: string;
  readonly status: string;
}

interface JsonReport {
  readonly testResults: readonly { readonly assertionResults: readonly JsonAssertion[] }[];
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'attack-suite-'));
const reportPath = join(scratch, 'report.json');

try {
  const run = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      'apps/warden/test/attacks',
      '--maxWorkers=2',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reads only the report this run wrote into its own temporary folder
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport;
  const rows: Row[] = [];
  for (const file of report.testResults) {
    for (const assertion of file.assertionResults) {
      const parts = assertion.title.split(' | ');
      const [id = '?', caseName = assertion.title, expected = '-'] = parts;
      rows.push({
        id,
        caseName,
        expected,
        passed: assertion.status === 'passed',
      });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));

  const width = {
    id: Math.max(2, ...rows.map((row) => row.id.length)),
    caseName: Math.min(52, Math.max(4, ...rows.map((row) => row.caseName.length))),
    expected: Math.min(44, Math.max(8, ...rows.map((row) => row.expected.length))),
  };
  const clip = (text: string, size: number): string =>
    text.length > size ? `${text.slice(0, size - 1)}…` : text.padEnd(size);

  const line = '-'.repeat(width.id + width.caseName + width.expected + 12);
  console.log('Warden attack suite (offline, in-memory ledger; not a Testnet run)');
  console.log(line);
  console.log(
    `${'ID'.padEnd(width.id)}  ${'Case'.padEnd(width.caseName)}  ${'Expected outcome'.padEnd(width.expected)}  Result`,
  );
  console.log(line);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(width.id)}  ${clip(row.caseName, width.caseName)}  ${clip(row.expected, width.expected)}  ${row.passed ? 'PASS' : 'FAIL'}`,
    );
  }
  console.log(line);
  const passed = rows.filter((row) => row.passed).length;
  console.log(
    `${String(rows.length)} cases, ${String(passed)} passed, ${String(rows.length - passed)} failed`,
  );

  process.exitCode = run.status === 0 && rows.length > 0 ? 0 : 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
