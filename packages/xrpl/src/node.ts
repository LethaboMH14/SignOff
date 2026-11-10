// Node-only entry point (import from '@signoff/xrpl/node'). Local files live outside the repository.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { JournalRecord, JournalState } from './journal.js';
import { JOURNAL_STATES } from './journal.js';
import { registrySchema, type Registry } from './registry.js';
import type { JournalStore, RegistryStore } from './store.js';

/** Runs a synchronous step and always returns a promise: a thrown error becomes a rejection. */
function attempt<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('storage failed'));
  }
}

/** The local directory for registry, journal and lock. Override with SIGNOFF_LOCAL_DIR. */
export function defaultLocalDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env['SIGNOFF_LOCAL_DIR'];
  if (override !== undefined && override !== '') {
    return resolve(override);
  }
  if (platform === 'win32') {
    const base = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'SignOff', 'testnet');
  }
  return join(homedir(), '.signoff', 'testnet');
}

/** Refuses a local directory inside the repository, so seeds can never be committed by accident. */
export function assertOutsideRepository(dir: string, repoRoot: string): void {
  const rel = relative(resolve(repoRoot), resolve(dir));
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (inside) {
    throw new Error('the local directory must be outside the repository');
  }
}

function ensureDirectory(dir: string): void {
  // The directory is chosen by the operator and checked by assertOutsideRepository before use.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Writes a file so that a crash leaves either the old or the new content, never a mix. */
function writeAtomic(path: string, content: string): void {
  ensureDirectory(dirname(path));
  const temp = `${path}.${String(process.pid)}.tmp`;
  // The path is the operator's registry location, checked by assertOutsideRepository.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fd = openSync(temp, 'w', 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  renameSync(temp, path);
}

/** A registry kept as one JSON file, validated on every read and write. */
export function fileRegistryStore(path: string): RegistryStore {
  return {
    read: () =>
      attempt((): Registry | null => {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (!existsSync(path)) {
          return null;
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return registrySchema.parse(raw);
      }),
    write: (registry: Registry) =>
      attempt(() => {
        writeAtomic(path, `${JSON.stringify(registrySchema.parse(registry), null, 2)}\n`);
      }),
  };
}

function isJournalState(value: unknown): value is JournalState {
  return typeof value === 'string' && (JOURNAL_STATES as readonly string[]).includes(value);
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`journal field ${name} has the wrong type`);
  }
  return value;
}

function optionalCount(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new Error(`journal field ${name} has the wrong type`);
  }
  return value;
}

/** Reads one journal line back into a record. Any unexpected shape is an error, never a guess. */
export function toJournalRecord(value: unknown): JournalRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error('journal line is not an object');
  }
  const fields = value as Readonly<Record<string, unknown>>;
  const paymentId = fields['paymentId'];
  const attemptNumber = fields['attempt'];
  const state = fields['state'];
  const at = fields['at'];
  if (
    typeof paymentId !== 'string' ||
    typeof attemptNumber !== 'number' ||
    !isJournalState(state) ||
    typeof at !== 'string'
  ) {
    throw new Error('journal line is missing required fields');
  }
  const hash = optionalText(fields['hash'], 'hash');
  const txBlob = optionalText(fields['txBlob'], 'txBlob');
  const engineResult = optionalText(fields['engineResult'], 'engineResult');
  const reason = optionalText(fields['reason'], 'reason');
  const lastLedgerSequence = optionalCount(fields['lastLedgerSequence'], 'lastLedgerSequence');
  const ledgerIndex = optionalCount(fields['ledgerIndex'], 'ledgerIndex');
  return {
    paymentId,
    attempt: attemptNumber,
    state,
    at,
    ...(hash === undefined ? {} : { hash }),
    ...(txBlob === undefined ? {} : { txBlob }),
    ...(lastLedgerSequence === undefined ? {} : { lastLedgerSequence }),
    ...(engineResult === undefined ? {} : { engineResult }),
    ...(ledgerIndex === undefined ? {} : { ledgerIndex }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** An append-only journal, one JSON object per line. Every append is flushed to disk before it returns. */
export function fileJournalStore(path: string): JournalStore {
  return {
    append: (record: JournalRecord) =>
      attempt(() => {
        ensureDirectory(dirname(path));
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const fd = openSync(path, 'a', 0o600);
        try {
          writeSync(fd, `${JSON.stringify(record)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }),
    readAll: () =>
      attempt((): JournalRecord[] => {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (!existsSync(path)) {
          return [];
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const lines = readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line.trim() !== '');
        return lines.map((line) => toJournalRecord(JSON.parse(line) as unknown));
      }),
  };
}

/**
 * Runs a function while holding the directory lock. A second run, or a run that crashed without
 * releasing the lock, is refused: the journal must be inspected before anything is sent again.
 */
export async function withLock<T>(dir: string, run: () => Promise<T>): Promise<T> {
  ensureDirectory(dir);
  const lockPath = join(dir, 'run.lock');
  let fd: number;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fd = openSync(lockPath, 'wx', 0o600);
  } catch {
    throw new Error(
      'another run holds the lock, or a previous run did not finish; inspect the journal first',
    );
  }
  writeSync(fd, `${String(process.pid)}\n`);
  closeSync(fd);
  try {
    return await run();
  } finally {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    unlinkSync(lockPath);
  }
}
