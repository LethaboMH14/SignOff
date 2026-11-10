import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '..', 'setup-hooks.mjs');
const createdDirectories: string[] = [];

function freshDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

function runSetup(cwd: string): string {
  return execFileSync(process.execPath, [script], { cwd, encoding: 'utf8' });
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('setup-hooks', () => {
  it('points core.hooksPath at .githooks in a git checkout, for that clone only', () => {
    const repository = freshDirectory('signoff-hooks-');
    execFileSync('git', ['init', '-q'], { cwd: repository });

    const output = runSetup(repository);
    const configured = execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();

    expect(output).toContain('git hooks enabled from .githooks');
    expect(configured).toBe('.githooks');
  });

  it('does nothing outside a git checkout and still succeeds', () => {
    const plain = freshDirectory('signoff-nogit-');

    const output = runSetup(plain);

    expect(output).toContain('not a git checkout');
  });
});
