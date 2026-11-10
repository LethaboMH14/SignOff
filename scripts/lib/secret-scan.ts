import { execFile } from 'node:child_process';

import {
  findSecrets,
  type SecretKind,
} from '../../packages/shared/src/security/secret-patterns.js';

/**
 * Secret scanner for commits and for the whole repository (rule R-12).
 *
 * It reads content from Git's object store, never from the working copy. A pre-commit check
 * must judge what is about to be committed, and CI must judge what is tracked. Process spawning
 * uses argument arrays and no shell, so file names can never be interpreted as commands.
 */

export type ScanMode = 'staged' | 'all';

export interface ScanIssue {
  readonly path: string;
  readonly kind: SecretKind | 'denied-file-name';
  readonly line?: number;
  readonly column?: number;
}

export interface ScanOutcome {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

export interface BlobEntry {
  readonly path: string;
  readonly sha: string;
}

/** Large enough for the whole tracked content of this repository. */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/** Extensions of key and keystore files, which must never be committed. */
const DENIED_EXTENSION = /\.(?:pem|key|p12|pfx|keystore|jks)$/;

/** Private SSH key file names. Their public halves (.pub) are not secret and stay allowed. */
const DENIED_FILE_NAMES: ReadonlySet<string> = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

/**
 * True for file names that must never be committed, whatever their contents. Environment files
 * are denied, except the .env.example template.
 */
export function isDeniedPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name === '.env') return true;
  if (name.startsWith('.env.') && name !== '.env.example') return true;
  return DENIED_EXTENSION.test(name) || DENIED_FILE_NAMES.has(name);
}

/** Run git with an argument array and no shell. Errors name the subcommand only, never output. */
function runGit(cwd: string, args: readonly string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd, encoding: 'buffer', maxBuffer: GIT_MAX_BUFFER, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(new Error(`git ${args[0] ?? ''} failed`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Parse `git diff --cached --raw -z`. Each record is ":oldmode newmode oldsha newsha status" NUL
 * path NUL. Matching is contiguous: any byte that does not belong to a record fails the parse, so
 * the scan fails closed rather than skipping content it could not read.
 */
export function parseRawDiff(output: string): BlobEntry[] {
  const record = /:\d{6} \d{6} [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*\0([^\0]+)\0/g;
  const entries: BlobEntry[] = [];
  let consumed = 0;
  for (const match of output.matchAll(record)) {
    if (match.index !== consumed) throw new Error('unexpected output from git diff');
    consumed += match[0].length;
    const sha = match[1];
    const path = match[2];
    if (sha === undefined || path === undefined) throw new Error('unexpected output from git diff');
    if (/^0+$/.test(sha)) continue; // a deletion has no content to scan
    entries.push({ path, sha });
  }
  if (consumed !== output.length) throw new Error('unexpected output from git diff');
  return entries;
}

/**
 * Parse `git ls-files -s -z`. Each record is "mode sha stage<TAB>path" NUL. Submodule pointers
 * (mode 160000) hold no content and are skipped. Contiguity is enforced as in parseRawDiff.
 */
export function parseIndexEntries(output: string): BlobEntry[] {
  const record = /(\d{6}) ([0-9a-f]{40,64}) \d\t([^\0]+)\0/g;
  const entries: BlobEntry[] = [];
  let consumed = 0;
  for (const match of output.matchAll(record)) {
    if (match.index !== consumed) throw new Error('unexpected output from git ls-files');
    consumed += match[0].length;
    const mode = match[1];
    const sha = match[2];
    const path = match[3];
    if (mode === undefined || sha === undefined || path === undefined) {
      throw new Error('unexpected output from git ls-files');
    }
    if (mode === '160000') continue;
    entries.push({ path, sha });
  }
  if (consumed !== output.length) throw new Error('unexpected output from git ls-files');
  return entries;
}

/** Issues for a file name alone. */
export function scanPathName(path: string): ScanIssue[] {
  return isDeniedPath(path) ? [{ path, kind: 'denied-file-name' }] : [];
}

/**
 * Issues for the content of one blob. Binary content (a NUL byte) is not text-scanned; the
 * caller counts those files so the limitation is visible in every report.
 */
export function scanBlob(
  path: string,
  content: Uint8Array,
): { issues: ScanIssue[]; scanned: boolean } {
  if (content.includes(0)) {
    return { issues: [], scanned: false };
  }
  const text = Buffer.from(content).toString('utf8');
  const issues = findSecrets(text).map((finding) => ({
    path,
    kind: finding.kind,
    line: finding.line,
    column: finding.column,
  }));
  return { issues, scanned: true };
}

async function listStagedBlobs(cwd: string): Promise<BlobEntry[]> {
  const output = await runGit(cwd, [
    'diff',
    '--cached',
    '--raw',
    '-z',
    '--no-renames',
    '--diff-filter=ACMR',
  ]);
  return parseRawDiff(output.toString('utf8'));
}

async function listTrackedBlobs(cwd: string): Promise<BlobEntry[]> {
  const output = await runGit(cwd, ['ls-files', '-s', '-z']);
  return parseIndexEntries(output.toString('utf8'));
}

export interface RepositoryScan {
  readonly issues: ScanIssue[];
  readonly filesChecked: number;
  readonly binaryFiles: number;
}

/** Scan the staged content (mode "staged") or every tracked file (mode "all"). */
export async function scanRepository(cwd: string, mode: ScanMode): Promise<RepositoryScan> {
  const entries = mode === 'staged' ? await listStagedBlobs(cwd) : await listTrackedBlobs(cwd);
  const issues: ScanIssue[] = [];
  let binaryFiles = 0;

  for (const entry of entries) {
    issues.push(...scanPathName(entry.path));
    const content = await runGit(cwd, ['cat-file', 'blob', entry.sha]);
    const result = scanBlob(entry.path, content);
    issues.push(...result.issues);
    if (!result.scanned) binaryFiles++;
  }

  return { issues, filesChecked: entries.length, binaryFiles };
}

/** Parse the command line. Exactly one of --staged or --all is required; nothing else is accepted. */
export function parseArguments(argv: readonly string[]): { mode: ScanMode } | { error: string } {
  if (argv.some((argument) => argument !== '--staged' && argument !== '--all')) {
    return { error: 'unknown argument' };
  }
  if (argv.length !== 1) {
    return { error: 'choose exactly one of --staged or --all' };
  }
  return { mode: argv[0] === '--staged' ? 'staged' : 'all' };
}

function formatIssue(issue: ScanIssue): string {
  if (issue.kind === 'denied-file-name') {
    return `${issue.path}: this file name must not be committed`;
  }
  return `${issue.path}:${String(issue.line ?? 0)}:${String(issue.column ?? 0)}: ${issue.kind}`;
}

/** The whole command: parse, scan, and report. Values are never printed, only kinds and positions. */
export async function runSecretScanCli(argv: readonly string[], cwd: string): Promise<ScanOutcome> {
  const parsed = parseArguments(argv);
  if ('error' in parsed) {
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`secret-scan: ${parsed.error}. Usage: secret-scan --staged | --all`],
    };
  }

  try {
    const scan = await scanRepository(cwd, parsed.mode);
    const stdout = scan.issues.map(formatIssue);
    stdout.push(
      `secret-scan (${parsed.mode}): ${String(scan.filesChecked)} file(s) checked, ` +
        `${String(scan.issues.length)} issue(s), ${String(scan.binaryFiles)} binary file(s) not text-scanned`,
    );
    return { exitCode: scan.issues.length > 0 ? 1 : 0, stdout, stderr: [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`secret-scan: could not read the repository (${reason}). Is this a git checkout?`],
    };
  }
}
