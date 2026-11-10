import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isDeniedPath,
  parseArguments,
  parseIndexEntries,
  parseRawDiff,
  runSecretScanCli,
  scanBlob,
  scanPathName,
} from '../lib/secret-scan.js';
import {
  corruptOneCharacter,
  encodeFamilySeed,
  fixedEntropy,
  SECP256K1_SEED_PREFIX,
} from '../../packages/shared/test/helpers/xrpl-fixtures.js';

// Built at run time, so this file holds no complete secret.
const SEED = encodeFamilySeed(SECP256K1_SEED_PREFIX, fixedEntropy(11));
const CLEAN_CONTENT = 'export const amountMinor = 12500;\n';

const createdDirectories: string[] = [];

function makeRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'signoff-scan-'));
  createdDirectories.push(directory);
  git(directory, ['init', '-q']);
  return directory;
}

function makePlainDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'signoff-plain-'));
  createdDirectories.push(directory);
  return directory;
}

function git(directory: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd: directory, stdio: 'pipe' });
}

function writeFile(directory: string, relativePath: string, content: string): void {
  const absolute = join(directory, relativePath);
  // Test-only writes inside temporary repositories that this file creates and removes.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  mkdirSync(dirname(absolute), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(absolute, content);
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('secret-scan --staged', () => {
  it('fails when the staged content contains a seed, and never prints the seed', async () => {
    const repository = makeRepository();
    writeFile(repository, 'config/local.ts', `export const token = '${SEED}';\n`);
    git(repository, ['add', 'config/local.ts']);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout.join('\n')).toContain('config/local.ts:1:');
    expect(outcome.stdout.join('\n')).toContain('xrpl-family-seed');
    expect(outcome.stdout.join('\n')).not.toContain(SEED);
  });

  it('judges the staged content, not the working copy', async () => {
    const repository = makeRepository();
    writeFile(repository, 'notes.ts', CLEAN_CONTENT);
    git(repository, ['add', 'notes.ts']);
    // The secret exists only in the working copy, which is not about to be committed.
    writeFile(repository, 'notes.ts', `export const token = '${SEED}';\n`);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(0);
  });

  it('catches a secret that was staged and then removed from the working copy', async () => {
    const repository = makeRepository();
    writeFile(repository, 'notes.ts', `export const token = '${SEED}';\n`);
    git(repository, ['add', 'notes.ts']);
    writeFile(repository, 'notes.ts', CLEAN_CONTENT);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(1);
  });

  it('passes a clean staged file and reports the count', async () => {
    const repository = makeRepository();
    writeFile(repository, 'src/amount.ts', CLEAN_CONTENT);
    git(repository, ['add', 'src/amount.ts']);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.at(-1)).toContain('1 file(s) checked, 0 issue(s)');
  });

  it('passes when nothing is staged', async () => {
    const repository = makeRepository();

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.at(-1)).toContain('0 file(s) checked');
  });

  it('fails a staged file whose name must never be committed, even with clean content', async () => {
    const repository = makeRepository();
    writeFile(repository, '.env', 'FEATURE_FLAG=on\n');
    git(repository, ['add', '.env']);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout.join('\n')).toContain('.env: this file name must not be committed');
  });

  it('allows the .env.example template', async () => {
    const repository = makeRepository();
    writeFile(repository, '.env.example', 'FEATURE_FLAG=\n');
    git(repository, ['add', '.env.example']);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(0);
  });

  it('counts binary files and does not text-scan them, so the limitation stays visible', async () => {
    const repository = makeRepository();
    writeFile(repository, 'image.bin', `\u0000\u0001${SEED}`);
    git(repository, ['add', 'image.bin']);

    const outcome = await runSecretScanCli(['--staged'], repository);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.at(-1)).toContain('1 binary file(s) not text-scanned');
  });

  it('fails closed outside a git checkout', async () => {
    const plain = makePlainDirectory();

    const outcome = await runSecretScanCli(['--staged'], plain);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join('\n')).toContain('Is this a git checkout?');
  });
});

describe('secret-scan --all', () => {
  it('scans what is tracked in the index and finds a seed there', async () => {
    const repository = makeRepository();
    writeFile(repository, 'leaked.ts', `const token = '${SEED}';\n`);
    git(repository, ['add', 'leaked.ts']);
    writeFile(repository, 'leaked.ts', CLEAN_CONTENT);

    const outcome = await runSecretScanCli(['--all'], repository);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout.join('\n')).toContain('leaked.ts:1:');
  });

  it('passes a repository whose tracked content is clean', async () => {
    const repository = makeRepository();
    writeFile(repository, 'a.ts', CLEAN_CONTENT);
    writeFile(repository, 'b.ts', CLEAN_CONTENT.replace('12500', '900'));
    git(repository, ['add', '.']);

    const outcome = await runSecretScanCli(['--all'], repository);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.at(-1)).toContain('2 file(s) checked');
  });
});

describe('secret-scan argument handling', () => {
  it.each([[[]], [['--staged', '--all']], [['--unknown']], [['--staged', '--verbose']]])(
    'rejects the arguments %j with exit code 2',
    async (argv) => {
      const outcome = await runSecretScanCli(argv, process.cwd());
      expect(outcome.exitCode).toBe(2);
      expect(outcome.stderr.join('\n')).toContain('Usage:');
    },
  );

  it('accepts exactly one mode', () => {
    expect(parseArguments(['--staged'])).toEqual({ mode: 'staged' });
    expect(parseArguments(['--all'])).toEqual({ mode: 'all' });
    expect(parseArguments(['--staged', '--all'])).toEqual({
      error: 'choose exactly one of --staged or --all',
    });
  });
});

describe('path and content rules', () => {
  it.each([
    ['.env', true],
    ['.env.local', true],
    ['config/.env.production', true],
    ['keys/server.pem', true],
    ['certs/client.p12', true],
    ['home/.ssh/id_rsa', true],
    ['.env.example', false],
    ['src/env.ts', false],
    ['docs/key-decisions.md', false],
    ['id_rsa.pub', false],
  ])('denies %s: %s', (path, denied) => {
    expect(scanPathName(path).length > 0).toBe(denied);
  });

  it('matches the denied-path rule on the file name, not on any part of the path', () => {
    expect(isDeniedPath('secrets/.env')).toBe(true);
    expect(isDeniedPath('.env/readme.md')).toBe(false);
  });

  it('reports a text blob containing a seed at its line and column', () => {
    const result = scanBlob('a.ts', Buffer.from(`one\ntwo ${SEED}\n`));
    expect(result.scanned).toBe(true);
    expect(result.issues).toEqual([{ path: 'a.ts', kind: 'xrpl-family-seed', line: 2, column: 5 }]);
  });

  it('does not text-scan a blob that contains a NUL byte', () => {
    const result = scanBlob('a.bin', Uint8Array.of(0, 65, 66));
    expect(result).toEqual({ issues: [], scanned: false });
  });

  it('does not flag a seed with one character corrupted', () => {
    const result = scanBlob('a.ts', Buffer.from(corruptOneCharacter(SEED, 9)));
    expect(result.issues).toEqual([]);
  });
});

describe('git output parsers fail closed', () => {
  it('parses a raw staged record into a path and a blob id', () => {
    const output =
      ':000000 100644 0000000000000000000000000000000000000000 ' +
      'a'.repeat(40) +
      ' A\0src/new.ts\0';
    expect(parseRawDiff(output)).toEqual([{ path: 'src/new.ts', sha: 'a'.repeat(40) }]);
  });

  it('skips a deletion, which has no content to scan', () => {
    const output = ':100644 000000 ' + 'b'.repeat(40) + ' ' + '0'.repeat(40) + ' D\0gone.ts\0';
    expect(parseRawDiff(output)).toEqual([]);
  });

  it('throws on malformed raw output', () => {
    expect(() => parseRawDiff('not a diff record\0path.ts\0')).toThrow(/unexpected output/);
    expect(() => parseRawDiff(':100644 100644 aa bb M\0')).toThrow(/unexpected output/);
  });

  it('parses index entries and skips submodule pointers', () => {
    const output =
      '100644 ' +
      'c'.repeat(40) +
      ' 0\tsrc/a.ts\0' +
      '160000 ' +
      'd'.repeat(40) +
      ' 0\tvendor/sub\0';
    expect(parseIndexEntries(output)).toEqual([{ path: 'src/a.ts', sha: 'c'.repeat(40) }]);
  });

  it('throws on malformed index output', () => {
    expect(() => parseIndexEntries('garbage\0')).toThrow(/unexpected output/);
  });
});
