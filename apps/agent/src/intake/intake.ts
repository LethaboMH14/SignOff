import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';

import { extractPdfText, type PdfFailure, type PdfTextResult } from './pdf-text.js';
import { normaliseText } from '../text/normalise.js';

/**
 * Intake: what arrives in the watched folder. Each file is read once, fingerprinted by the SHA-256 of its bytes, and
 * accepted only if it is a regular file holding a text PDF. Anything else is held before any model sees it.
 */

/** A larger file is held. An invoice is a few pages, and the limit keeps the parser's work bounded. */
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** A PDF with fewer printable characters than this has no usable text layer, so it is treated as a scan. */
export const MIN_TEXT_CHARS = 20;

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

export type IntakeHoldReason =
  | 'READ_FAILED'
  | 'NOT_A_REGULAR_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'PDF_UNREADABLE'
  | 'PDF_ENCRYPTED'
  | 'PDF_TOO_MANY_PAGES'
  | 'NO_TEXT_LAYER'
  | 'PDF_EXTRACTION_FAILED';

export type IntakeOutcome =
  | {
      readonly kind: 'text-pdf';
      readonly fingerprint: string;
      readonly bytes: number;
      /** The text of each page as the parser read it. Hidden text is included on purpose: the screen reads it. */
      readonly pages: readonly string[];
    }
  | {
      readonly kind: 'held';
      /** Null when the file was not read, so it has no fingerprint. */
      readonly fingerprint: string | null;
      readonly bytes: number;
      readonly reason: IntakeHoldReason;
    };

export type TextExtractor = (bytes: Uint8Array) => Promise<PdfTextResult>;

const FAILURE_REASONS: Readonly<Record<PdfFailure, IntakeHoldReason>> = {
  ENCRYPTED: 'PDF_ENCRYPTED',
  UNREADABLE: 'PDF_UNREADABLE',
  TOO_MANY_PAGES: 'PDF_TOO_MANY_PAGES',
  EXTRACTION_FAILED: 'PDF_EXTRACTION_FAILED',
};

/** Accepts or holds one file. The file is read once, and every later step uses those same bytes. */
export async function intakeFile(
  path: string,
  extract: TextExtractor = extractPdfText,
): Promise<IntakeOutcome> {
  const held = (reason: IntakeHoldReason, fingerprint: string | null, bytes: number) =>
    ({ kind: 'held', fingerprint, bytes, reason }) as const;

  let size: number;
  try {
    // lstat does not follow links, so a symbolic link is not a regular file and is held.
    // The path is the operator's inbox entry, read once per scan.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const info = lstatSync(path);
    if (!info.isFile()) {
      return held('NOT_A_REGULAR_FILE', null, 0);
    }
    size = info.size;
  } catch {
    return held('READ_FAILED', null, 0);
  }
  if (size > MAX_INVOICE_BYTES) {
    return held('FILE_TOO_LARGE', null, size);
  }

  let bytes: Buffer;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    bytes = readFileSync(path);
  } catch {
    return held('READ_FAILED', null, 0);
  }
  if (bytes.length > MAX_INVOICE_BYTES) {
    return held('FILE_TOO_LARGE', null, bytes.length);
  }
  const fingerprint = sha256OfBytes(bytes);
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return held('UNSUPPORTED_FILE_TYPE', fingerprint, bytes.length);
  }

  const result = await extract(bytes);
  if (!result.ok) {
    return held(FAILURE_REASONS[result.reason], fingerprint, bytes.length);
  }
  const printable = normaliseText(result.pages.join(' ')).length;
  if (printable < MIN_TEXT_CHARS) {
    return held('NO_TEXT_LAYER', fingerprint, bytes.length);
  }
  return { kind: 'text-pdf', fingerprint, bytes: bytes.length, pages: result.pages };
}

/**
 * The files in the inbox, in name order. Hidden files and Office lock files are skipped, because they are not
 * invoices. Only names are read here; nothing is opened.
 */
export function listInbox(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !name.startsWith('~'))
    .sort()
    .map((name) => join(dir, name));
}

export interface ScanOptions {
  readonly dir: string;
  /** Keys already handled: a file fingerprint, or a path key for a file that could not be fingerprinted. */
  readonly seen: Set<string>;
  readonly extract?: TextExtractor;
  readonly onOutcome: (key: string, path: string, outcome: IntakeOutcome) => Promise<void>;
}

/**
 * One pass over the inbox. A file whose fingerprint was handled before is skipped, so a re-sent PDF is not processed
 * twice. A file that could not be fingerprinted is keyed by its path for this process only.
 */
export async function scanOnce(options: ScanOptions): Promise<number> {
  let handled = 0;
  for (const path of listInbox(options.dir)) {
    const outcome = await intakeFile(path, options.extract);
    const key = outcome.fingerprint ?? sha256OfBytes(Buffer.from(path, 'utf8'));
    if (options.seen.has(key)) {
      continue;
    }
    options.seen.add(key);
    handled += 1;
    await options.onOutcome(key, path, outcome);
  }
  return handled;
}

export interface WatchOptions extends ScanOptions {
  readonly intervalMs: number;
  readonly signal: AbortSignal;
}

/**
 * Watches the inbox by polling it. Polling is slower than file-system events but behaves the same on every platform,
 * and a missed event cannot leave a file unprocessed, because every pass looks at the whole folder again.
 */
export async function watchInbox(options: WatchOptions): Promise<void> {
  while (!options.signal.aborted) {
    await scanOnce(options);
    await sleep(options.intervalMs, options.signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
