import { lstatSync, readdirSync, readFileSync, type Stats } from 'node:fs';
import { basename, join } from 'node:path';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';

import { classifyDocument, type ClassifyHold } from './classify.js';
import { extractPdfText, type PdfExtras, type PdfFailure, type PdfTextResult } from './pdf-text.js';
import {
  formatHoldOf,
  imageSizeOf,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  sniffFormat,
} from './sniff.js';

import { normaliseText } from '../text/normalise.js';
import { OcrError, recogniseImage, type ImageRecogniser, type OcrLanguages } from '../text/ocr.js';

/**
 * Intake: what arrives in the watched folder. A file is read only once its size and modification time have held across
 * two polls, is fingerprinted by the SHA-256 of its bytes, and is checked before any parser or model sees it. A file
 * that is not a ZAR tax invoice, or cannot be read with confidence, is held with a reason code.
 */

/** A larger file is held. An invoice is a few pages, and the limit keeps the parser's work bounded. */
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** A PDF with fewer printable characters than this has no usable text layer, so it is treated as a scan. */
export const MIN_TEXT_CHARS = 20;

/** OCR below this mean word confidence (0 to 100) holds the page. Measured pages read at 93 to 95 (see TEST-LOG). */
export const OCR_MIN_CONFIDENCE = 70;

/** The languages read for an image. Afrikaans is included because South African suppliers print in both. */
export const OCR_LANGUAGES: OcrLanguages = 'eng+afr';

export type IntakeHoldReason =
  | 'READ_FAILED'
  | 'NOT_A_REGULAR_FILE'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'MIME_EXTENSION_MISMATCH'
  | 'FORMAT_HEIC_NOT_PARSED'
  | 'FORMAT_DOCX_NOT_PARSED'
  | 'FORMAT_XLSX_NOT_PARSED'
  | 'FORMAT_UBL_XML_NOT_PARSED'
  | 'PDF_UNREADABLE'
  | 'PDF_ENCRYPTED'
  | 'PDF_TOO_MANY_PAGES'
  | 'PDF_EXTRACTION_FAILED'
  | 'PDF_TEXT_TRUNCATED'
  | 'NO_TEXT_LAYER'
  | 'OCR_IMAGE_TOO_LARGE'
  | 'OCR_IMAGE_UNREADABLE'
  | 'OCR_LOW_CONFIDENCE'
  | 'OCR_NO_TEXT'
  | 'OCR_LANGUAGE_DATA_MISSING'
  | 'OCR_LANGUAGE_DATA_MISMATCH'
  | 'OCR_FAILED'
  | ClassifyHold;

export type IntakeOutcome =
  | {
      readonly kind: 'text-pdf';
      readonly fingerprint: string;
      readonly bytes: number;
      /** The text of each page as the parser read it. Hidden text is included on purpose: the screen reads it. */
      readonly pages: readonly string[];
      /** Annotation and document-information text, which is screened with the pages. */
      readonly extras: PdfExtras;
    }
  | {
      /** A scanned or photographed page read by OCR. The reading is a second, unverified source, so it carries its confidence. */
      readonly kind: 'text-ocr';
      readonly fingerprint: string;
      readonly bytes: number;
      readonly pages: readonly string[];
      /** Mean OCR word confidence, 0 to 100. Below OCR_MIN_CONFIDENCE the file is held, never read. */
      readonly ocrConfidence: number;
    }
  | {
      readonly kind: 'held';
      /** Null when the file was not read, so it has no fingerprint. */
      readonly fingerprint: string | null;
      readonly bytes: number;
      /** The first reason, for the transition log. */
      readonly reason: IntakeHoldReason;
      /** Every reason found, in a fixed order. */
      readonly reasons: readonly IntakeHoldReason[];
    }
  | {
      /** The file's bytes were already handled. No parser or model ran on it. */
      readonly kind: 'seen';
      readonly fingerprint: string;
      readonly bytes: number;
    };

export type TextExtractor = (bytes: Uint8Array) => Promise<PdfTextResult>;

export interface IntakeOptions {
  /** Replaces the PDF text extractor. Tests use it to count calls. */
  readonly extract?: TextExtractor;
  /** Replaces the image reader. Tests and the evaluation can supply one; the default is the Tesseract OCR module. */
  readonly recognise?: ImageRecogniser;
  /** Called with a fingerprint before any parsing. A true answer means the bytes were handled before. */
  readonly alreadySeen?: (fingerprint: string) => boolean;
}

const FAILURE_REASONS: Readonly<Record<PdfFailure, IntakeHoldReason>> = {
  ENCRYPTED: 'PDF_ENCRYPTED',
  UNREADABLE: 'PDF_UNREADABLE',
  TOO_MANY_PAGES: 'PDF_TOO_MANY_PAGES',
  EXTRACTION_FAILED: 'PDF_EXTRACTION_FAILED',
};

function held(
  fingerprint: string | null,
  bytes: number,
  reasons: readonly IntakeHoldReason[],
): IntakeOutcome {
  return { kind: 'held', fingerprint, bytes, reason: reasons[0] ?? 'READ_FAILED', reasons };
}

/**
 * Reads one file once and decides what it is. The bytes are fingerprinted, and the fingerprint is checked before any
 * parser runs. A PDF goes to the text extractor; a PNG or JPEG goes to OCR; anything else is held with its reason.
 */
export async function intakeFile(
  path: string,
  options: IntakeOptions = {},
): Promise<IntakeOutcome> {
  let info: Stats;
  try {
    // lstat does not follow links, so a symbolic link is not a regular file and is held.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    info = lstatSync(path);
  } catch {
    return held(null, 0, ['READ_FAILED']);
  }
  if (!info.isFile()) {
    return held(null, 0, ['NOT_A_REGULAR_FILE']);
  }
  if (info.size > MAX_INVOICE_BYTES) {
    return held(null, info.size, ['FILE_TOO_LARGE']);
  }
  let bytes: Buffer;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    bytes = readFileSync(path);
  } catch {
    return held(null, 0, ['READ_FAILED']);
  }
  return admitBytes(basename(path), bytes, options);
}

/**
 * The checks on bytes already read. Used for the inbox and for console uploads, so both paths get the same checks.
 * The file name is used only for the extension check; it is not a path.
 */
export async function admitBytes(
  fileName: string,
  bytes: Uint8Array,
  options: IntakeOptions = {},
): Promise<IntakeOutcome> {
  const fingerprint = sha256OfBytes(bytes);
  if (bytes.length === 0) {
    return held(fingerprint, 0, ['EMPTY_FILE']);
  }
  if (bytes.length > MAX_INVOICE_BYTES) {
    return held(null, bytes.length, ['FILE_TOO_LARGE']);
  }
  // The seen-check comes before any parsing: a file handled before makes no extract or OCR call.
  if (options.alreadySeen?.(fingerprint) === true) {
    return { kind: 'seen', fingerprint, bytes: bytes.length };
  }

  const format = sniffFormat(bytes);
  const formatHold = formatHoldOf(format, fileName);
  if (formatHold !== null) {
    return held(fingerprint, bytes.length, [formatHold]);
  }

  if (format === 'PDF') {
    return readPdf(fingerprint, bytes, options.extract ?? extractPdfText);
  }
  // The format is PNG or JPEG here, because formatHoldOf returned null for every other format the agent can read.
  return readImage(
    fingerprint,
    bytes,
    format === 'PNG' ? 'PNG' : 'JPEG',
    options.recognise ?? recogniseImage,
  );
}

async function readPdf(
  fingerprint: string,
  bytes: Uint8Array,
  extract: TextExtractor,
): Promise<IntakeOutcome> {
  const result = await extract(bytes);
  if (!result.ok) {
    return held(fingerprint, bytes.length, [FAILURE_REASONS[result.reason]]);
  }
  if (result.truncated) {
    // The parser cut text at its limit. A cut invoice would be read from less than the document says, so it is held.
    return held(fingerprint, bytes.length, ['PDF_TEXT_TRUNCATED']);
  }
  const printable = normaliseText(result.pages.join(' ')).length;
  if (printable < MIN_TEXT_CHARS) {
    return held(fingerprint, bytes.length, ['NO_TEXT_LAYER']);
  }
  const classification = classifyDocument(result.pages);
  if (classification.holds.length > 0) {
    return held(fingerprint, bytes.length, classification.holds);
  }
  return {
    kind: 'text-pdf',
    fingerprint,
    bytes: bytes.length,
    pages: result.pages,
    extras: result.extras,
  };
}

async function readImage(
  fingerprint: string,
  bytes: Uint8Array,
  format: 'PNG' | 'JPEG',
  recognise: ImageRecogniser,
): Promise<IntakeOutcome> {
  const size = imageSizeOf(format, bytes);
  if (size === null) {
    return held(fingerprint, bytes.length, ['OCR_IMAGE_UNREADABLE']);
  }
  if (
    size.width > MAX_IMAGE_SIDE ||
    size.height > MAX_IMAGE_SIDE ||
    size.width * size.height > MAX_IMAGE_PIXELS
  ) {
    return held(fingerprint, bytes.length, ['OCR_IMAGE_TOO_LARGE']);
  }
  let reading: Awaited<ReturnType<ImageRecogniser>>;
  try {
    reading = await recognise(bytes, format, OCR_LANGUAGES);
  } catch (error) {
    // A missing or altered language file, or an unreadable image, holds the file under its own reason. It never passes.
    const reason = error instanceof OcrError ? error.reason : 'OCR_FAILED';
    return held(fingerprint, bytes.length, [reason]);
  }
  if (reading.text.length === 0) {
    return held(fingerprint, bytes.length, ['OCR_NO_TEXT']);
  }
  if (reading.confidence < OCR_MIN_CONFIDENCE) {
    return held(fingerprint, bytes.length, ['OCR_LOW_CONFIDENCE']);
  }
  const pages = [reading.text];
  const classification = classifyDocument(pages);
  if (classification.holds.length > 0) {
    return held(fingerprint, bytes.length, classification.holds);
  }
  return {
    kind: 'text-ocr',
    fingerprint,
    bytes: bytes.length,
    pages,
    ocrConfidence: reading.confidence,
  };
}

/**
 * The files in the inbox, in name order. Hidden files and Office lock files are skipped, because they are not
 * invoices. Only names are read here; nothing is opened.
 */
export function listInbox(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const names = readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
  return names
    .filter((name) => !name.startsWith('.') && !name.startsWith('~'))
    .sort()
    .map((name) => join(dir, name));
}

export interface ScanOptions extends IntakeOptions {
  readonly dir: string;
  /**
   * Keys already handled: a file fingerprint, a path key for a file that could not be fingerprinted, or a stat key
   * (path, size and modification time) for a file already handled. A stat-key match means no read at all.
   */
  readonly seen: Set<string>;
  /** Last poll's stat key per path. A file is read only after its key is the same on two polls in a row. */
  readonly stability?: Map<string, string>;
  readonly onOutcome: (key: string, path: string, outcome: IntakeOutcome) => Promise<void>;
}

/**
 * One pass over the inbox. A file is read only when its size and modification time are unchanged across two polls, so
 * a file still being copied is not read half-written. A file whose fingerprint was handled before is skipped before it
 * is parsed. A file that could not be fingerprinted is keyed by its path for this process only.
 */
export async function scanOnce(options: ScanOptions): Promise<number> {
  const stability = options.stability ?? new Map<string, string>();
  let handled = 0;
  for (const path of listInbox(options.dir)) {
    let info: Stats;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      info = lstatSync(path);
    } catch {
      // The file was removed after it was listed. There is nothing to hold.
      continue;
    }
    const statKey = statKeyOf(path, info);
    if (options.seen.has(statKey)) {
      continue;
    }
    if (!info.isFile()) {
      // Links, folders and other entries are held at once. They are never read, so waiting would gain nothing.
      const key = sha256OfBytes(Buffer.from(path, 'utf8'));
      options.seen.add(key);
      options.seen.add(statKey);
      handled += 1;
      await options.onOutcome(key, path, held(null, 0, ['NOT_A_REGULAR_FILE']));
      continue;
    }
    if (stability.get(path) !== statKey) {
      // First sighting, or the file changed since the last poll. Wait for the next poll before reading it.
      stability.set(path, statKey);
      continue;
    }

    const outcome = await intakeFile(path, {
      ...options,
      alreadySeen: (fingerprint) => options.seen.has(fingerprint),
    });
    // The file may have changed while it was read. If so, the read is discarded and the new state must settle again.
    const after = statOrNull(path);
    if (after === null || statKeyOf(path, after) !== statKey) {
      if (after !== null) {
        stability.set(path, statKeyOf(path, after));
      } else {
        stability.delete(path);
      }
      continue;
    }
    stability.delete(path);
    if (outcome.kind === 'seen') {
      options.seen.add(statKey);
      continue;
    }
    const key = outcome.fingerprint ?? sha256OfBytes(Buffer.from(path, 'utf8'));
    options.seen.add(key);
    options.seen.add(statKey);
    handled += 1;
    await options.onOutcome(key, path, outcome);
  }
  return handled;
}

/** The file's status without following links, or null when it no longer exists. */
function statOrNull(path: string): Stats | null {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return lstatSync(path);
  } catch {
    return null;
  }
}

function statKeyOf(path: string, info: Stats): string {
  return `stat\u0000${path}\u0000${String(info.size)}\u0000${String(info.mtimeMs)}`;
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
  const stability = new Map<string, string>();
  while (!options.signal.aborted) {
    await scanOnce({ ...options, stability });
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
