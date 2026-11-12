/* eslint-disable security/detect-non-literal-fs-filename -- the tests create their own folders */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import {
  admitBytes,
  intakeFile,
  listInbox,
  MAX_INVOICE_BYTES,
  OCR_MIN_CONFIDENCE,
  scanOnce,
  watchInbox,
  type IntakeOutcome,
} from '../../src/intake/intake.js';
import { extractPdfText, type PdfTextResult } from '../../src/intake/pdf-text.js';
import { encodeGreyPng } from '../../src/text/image-io.js';
import { OcrError, closeOcr, type ImageRecogniser } from '../../src/text/ocr.js';
import { renderPage } from '../../tools/lib/glyph-page.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signoff-intake-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await closeOcr();
});

const TEXT_LINES = ['Invoice number: INV-TST-0100', 'Total due: 1500.00', 'Currency: ZAR'];

function write(name: string, bytes: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/** A counting wrapper: the tests check how often the parser ran, not what it returned. */
function counting<T extends (...args: never[]) => unknown>(
  inner: T,
): { fn: T; calls: () => number } {
  let calls = 0;
  const fn = ((...args: never[]) => {
    calls += 1;
    return inner(...args);
  }) as T;
  return { fn, calls: () => calls };
}

/** A minimal PNG header: the signature and the IHDR chunk with the given size. Enough for the header checks. */
function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

/** A real PNG of printed text, drawn with Roboto Regular, for the OCR path. */
function renderPng(lines: readonly string[]): Buffer {
  const page = renderPage(lines, {
    width: 1240,
    height: 400,
    fontSize: 36,
    marginX: 80,
    marginY: 80,
    lineHeight: 60,
  });
  expect(page.unsupported).toEqual([]);
  return encodeGreyPng(page.image);
}

const SCAN_TIMEOUT_MS = 120_000;

describe('intakeFile', () => {
  it('accepts a text PDF and fingerprints its bytes', async () => {
    const bytes = writeTextPdf([TEXT_LINES]);
    const outcome = await intakeFile(write('a.pdf', bytes));
    expect(outcome.kind).toBe('text-pdf');
    if (outcome.kind !== 'text-pdf') return;
    expect(outcome.fingerprint).toBe(sha256OfBytes(bytes));
    expect(outcome.bytes).toBe(bytes.length);
    expect(outcome.pages.join(' ')).toContain('INV-TST-0100');
    expect(outcome.extras).toEqual({ annotations: [], metadata: [] });
  });

  it('holds a file that is not a PDF, and still fingerprints it', async () => {
    const bytes = Buffer.from('Invoice number: INV-TST-0100 in plain text');
    const outcome = await intakeFile(write('a.txt', bytes));
    expect(outcome).toEqual({
      kind: 'held',
      fingerprint: sha256OfBytes(bytes),
      bytes: bytes.length,
      reason: 'UNSUPPORTED_FILE_TYPE',
      reasons: ['UNSUPPORTED_FILE_TYPE'],
    });
  });

  it('holds an empty file', async () => {
    expect(await intakeFile(write('empty.pdf', ''))).toMatchObject({
      kind: 'held',
      reason: 'EMPTY_FILE',
      bytes: 0,
    });
  });

  it('holds a PDF renamed to a picture extension, so the extension cannot lie about the format', async () => {
    const outcome = await intakeFile(write('renamed.png', writeTextPdf([TEXT_LINES])));
    expect(outcome).toMatchObject({ kind: 'held', reason: 'MIME_EXTENSION_MISMATCH' });
  });

  it('holds HEIC, DOCX, XLSX and UBL XML with a reason each, and parses none of them', async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic', 'latin1'),
      Buffer.alloc(16),
    ]);
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('....word/document.xml....'),
    ]);
    const xlsx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('....xl/workbook.xml....'),
    ]);
    const ubl = Buffer.from(
      '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"></Invoice>',
    );
    const cases: [string, Buffer, string][] = [
      ['photo.heic', heic, 'FORMAT_HEIC_NOT_PARSED'],
      ['letter.docx', docx, 'FORMAT_DOCX_NOT_PARSED'],
      ['sheet.xlsx', xlsx, 'FORMAT_XLSX_NOT_PARSED'],
      ['peppol.xml', ubl, 'FORMAT_UBL_XML_NOT_PARSED'],
    ];
    const extract = counting(() =>
      Promise.resolve<PdfTextResult>({ ok: false, reason: 'UNREADABLE' }),
    );
    for (const [name, bytes, reason] of cases) {
      const outcome = await intakeFile(write(name, bytes), { extract: extract.fn });
      expect(outcome).toMatchObject({ kind: 'held', reason });
    }
    expect(extract.calls()).toBe(0);
  });

  it('holds a PDF whose text the parser cut at its limit', async () => {
    const outcome = await intakeFile(write('long.pdf', writeTextPdf([TEXT_LINES])), {
      extract: () =>
        Promise.resolve({
          ok: true,
          pages: ['Invoice number: INV-TST-0100 Total due: 1500.00 Currency: ZAR'],
          extras: { annotations: [], metadata: [] },
          truncated: true,
        }),
    });
    expect(outcome).toMatchObject({ kind: 'held', reason: 'PDF_TEXT_TRUNCATED' });
  });

  it('maps each extractor failure to its own hold reason', async () => {
    const cases: readonly [PdfTextResult, string][] = [
      [{ ok: false, reason: 'ENCRYPTED' }, 'PDF_ENCRYPTED'],
      [{ ok: false, reason: 'UNREADABLE' }, 'PDF_UNREADABLE'],
      [{ ok: false, reason: 'TOO_MANY_PAGES' }, 'PDF_TOO_MANY_PAGES'],
      [{ ok: false, reason: 'EXTRACTION_FAILED' }, 'PDF_EXTRACTION_FAILED'],
    ];
    for (const [result, reason] of cases) {
      const outcome = await intakeFile(write(`${reason}.pdf`, '%PDF-1.4 x'), {
        extract: () => Promise.resolve(result),
      });
      expect(outcome).toMatchObject({ kind: 'held', reason });
    }
  });

  it('holds a PDF with no text layer, as a scan would be', async () => {
    const outcome = await intakeFile(write('scan.pdf', writeTextPdf([['   ']])));
    expect(outcome).toMatchObject({ kind: 'held', reason: 'NO_TEXT_LAYER' });
  });

  it('holds a PDF that cannot be parsed', async () => {
    const outcome = await intakeFile(write('bad.pdf', '%PDF-1.4 garbage'));
    expect(outcome).toMatchObject({ kind: 'held', reason: 'PDF_UNREADABLE' });
  });

  it('holds a file larger than the limit without reading it', async () => {
    const path = write('huge.pdf', Buffer.alloc(MAX_INVOICE_BYTES + 1, 0x20));
    const outcome = await intakeFile(path);
    expect(outcome).toEqual({
      kind: 'held',
      fingerprint: null,
      bytes: MAX_INVOICE_BYTES + 1,
      reason: 'FILE_TOO_LARGE',
      reasons: ['FILE_TOO_LARGE'],
    });
  });

  it('holds a folder entry that is not a regular file', async () => {
    mkdirSync(join(dir, 'nested'));
    expect(await intakeFile(join(dir, 'nested'))).toMatchObject({
      kind: 'held',
      fingerprint: null,
      reason: 'NOT_A_REGULAR_FILE',
    });
  });

  it('holds a missing file as a read failure', async () => {
    expect(await intakeFile(join(dir, 'absent.pdf'))).toMatchObject({
      kind: 'held',
      fingerprint: null,
      reason: 'READ_FAILED',
    });
  });

  it('holds a symbolic link rather than following it', async () => {
    const target = write('target.pdf', writeTextPdf([TEXT_LINES]));
    const link = join(dir, 'link.pdf');
    try {
      symlinkSync(target, link);
    } catch {
      // Creating links needs a privilege some Windows accounts lack. The check is then not run here.
      return;
    }
    expect(await intakeFile(link)).toMatchObject({
      kind: 'held',
      reason: 'NOT_A_REGULAR_FILE',
    });
  });

  it('holds an invoice that is not in ZAR, and a credit note that is not an invoice', async () => {
    const usd = await admitBytes(
      'usd.pdf',
      writeTextPdf([['Invoice number: INV-TST-0100', 'Total: 150.00 USD']]),
    );
    expect(usd).toMatchObject({ kind: 'held', reason: 'CURRENCY_NON_ZAR' });
    const credit = await admitBytes(
      'cn.pdf',
      writeTextPdf([['Credit note for INV-TST-0100', 'Currency: ZAR']]),
    );
    expect(credit).toMatchObject({ kind: 'held', reason: 'CLASS_CREDIT_NOTE' });
  });

  it('does not run the parser on bytes that were already handled', async () => {
    const bytes = writeTextPdf([TEXT_LINES]);
    const extract = counting(() =>
      Promise.resolve<PdfTextResult>({ ok: false, reason: 'UNREADABLE' }),
    );
    const outcome = await admitBytes('again.pdf', bytes, {
      extract: extract.fn,
      alreadySeen: () => true,
    });
    expect(outcome).toEqual({
      kind: 'seen',
      fingerprint: sha256OfBytes(bytes),
      bytes: bytes.length,
    });
    expect(extract.calls()).toBe(0);
  });

  it(
    'reads a photographed invoice through OCR and keeps the confidence of the reading',
    async () => {
      const png = renderPng([
        'Invoice number: INV-TST-0100',
        'Currency: ZAR',
        'Total due: 1500.00',
      ]);
      const outcome = await intakeFile(write('photo.png', png));
      expect(outcome.kind).toBe('text-ocr');
      if (outcome.kind !== 'text-ocr') return;
      expect(outcome.pages.join(' ')).toContain('INV-TST-0100');
      expect(outcome.ocrConfidence).toBeGreaterThanOrEqual(OCR_MIN_CONFIDENCE);
      expect(outcome.fingerprint).toBe(sha256OfBytes(png));
    },
    SCAN_TIMEOUT_MS,
  );

  it('holds a scan that OCR reads below the confidence floor, without a second reading', async () => {
    const recognise: ImageRecogniser = () =>
      Promise.resolve({
        text: 'Invoice number: INV-TST-0100',
        confidence: 40,
        correctedDegrees: 0,
        languages: 'eng+afr',
      });
    const outcome = await intakeFile(write('blurred.png', pngHeader(800, 600)), { recognise });
    expect(outcome).toMatchObject({ kind: 'held', reason: 'OCR_LOW_CONFIDENCE' });
  });

  it('holds a scan under its own reason when the OCR language data is missing', async () => {
    const recognise: ImageRecogniser = () =>
      Promise.reject(new OcrError('OCR_LANGUAGE_DATA_MISSING'));
    const outcome = await intakeFile(write('scan.png', pngHeader(800, 600)), { recognise });
    expect(outcome).toMatchObject({ kind: 'held', reason: 'OCR_LANGUAGE_DATA_MISSING' });
  });

  it('holds an image whose header is larger than the decoder will take, without running OCR', async () => {
    const recognise = counting<ImageRecogniser>(() => Promise.reject(new Error('must not run')));
    const outcome = await intakeFile(write('poster.png', pngHeader(9000, 9000)), {
      recognise: recognise.fn,
    });
    expect(outcome).toMatchObject({ kind: 'held', reason: 'OCR_IMAGE_TOO_LARGE' });
    expect(recognise.calls()).toBe(0);
  });
});

describe('listInbox', () => {
  it('lists invoice files in name order and skips hidden and lock files', () => {
    write('b.pdf', 'x');
    write('a.pdf', 'x');
    write('.DS_Store', 'x');
    write('~$lock.pdf', 'x');
    expect(listInbox(dir).map((path) => path.slice(dir.length + 1))).toEqual(['a.pdf', 'b.pdf']);
  });
});

describe('scanOnce and watchInbox', () => {
  it('reads a file only after its size and modification time hold across two polls', async () => {
    write('first.pdf', writeTextPdf([TEXT_LINES]));
    const extract = counting(extractPdfText);
    const handled: IntakeOutcome[] = [];
    const stability = new Map<string, string>();
    const options = {
      dir,
      seen: new Set<string>(),
      stability,
      extract: extract.fn,
      onOutcome: (_key: string, _path: string, outcome: IntakeOutcome) => {
        handled.push(outcome);
        return Promise.resolve();
      },
    };
    expect(await scanOnce(options)).toBe(0);
    expect(extract.calls()).toBe(0);
    expect(await scanOnce(options)).toBe(1);
    expect(extract.calls()).toBe(1);
    expect(handled.map((outcome) => outcome.kind)).toEqual(['text-pdf']);
  });

  it('does not read a file that is still growing, and reads it once it settles', async () => {
    write('growing.txt', 'Invoice number: INV-TST-0100');
    const handled: IntakeOutcome[] = [];
    const stability = new Map<string, string>();
    const options = {
      dir,
      seen: new Set<string>(),
      stability,
      onOutcome: (_key: string, _path: string, outcome: IntakeOutcome) => {
        handled.push(outcome);
        return Promise.resolve();
      },
    };
    expect(await scanOnce(options)).toBe(0);
    appendFileSync(join(dir, 'growing.txt'), '\nTotal due: 1500.00');
    expect(await scanOnce(options)).toBe(0);
    expect(await scanOnce(options)).toBe(1);
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ kind: 'held', reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('makes no parser call for an unchanged file or a re-sent copy on later polls', async () => {
    const bytes = writeTextPdf([TEXT_LINES]);
    write('first.pdf', bytes);
    write('copy.pdf', bytes);
    write('note.txt', 'not a pdf');
    const extract = counting(extractPdfText);
    const handled: IntakeOutcome[] = [];
    const stability = new Map<string, string>();
    const options = {
      dir,
      seen: new Set<string>(),
      stability,
      extract: extract.fn,
      onOutcome: (_key: string, _path: string, outcome: IntakeOutcome) => {
        handled.push(outcome);
        return Promise.resolve();
      },
    };

    expect(await scanOnce(options)).toBe(0);
    // Two files reach the handler: the PDF and the text file. The copy is seen by its fingerprint and is not counted.
    expect(await scanOnce(options)).toBe(2);
    expect(handled.map((outcome) => outcome.kind)).toEqual(['text-pdf', 'held']);
    // One parse for the PDF; the copy has the same fingerprint and is skipped before parsing; the text file is not a PDF.
    expect(extract.calls()).toBe(1);

    expect(await scanOnce(options)).toBe(0);
    expect(await scanOnce(options)).toBe(0);
    expect(extract.calls()).toBe(1);
    expect(handled).toHaveLength(2);
  });

  it('holds a folder entry on the first poll, because it is never read', async () => {
    mkdirSync(join(dir, 'folder'));
    const reports: string[] = [];
    const options = {
      dir,
      seen: new Set<string>(),
      onOutcome: (key: string) => {
        reports.push(key);
        return Promise.resolve();
      },
    };
    expect(await scanOnce(options)).toBe(1);
    expect(await scanOnce(options)).toBe(0);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('polls until it is aborted', async () => {
    write('one.pdf', writeTextPdf([TEXT_LINES]));
    const controller = new AbortController();
    let calls = 0;
    await watchInbox({
      dir,
      seen: new Set<string>(),
      intervalMs: 5,
      signal: controller.signal,
      onOutcome: () => {
        calls += 1;
        controller.abort();
        return Promise.resolve();
      },
    });
    expect(calls).toBe(1);
  });

  it('returns at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await watchInbox({
      dir,
      seen: new Set<string>(),
      intervalMs: 60_000,
      signal: controller.signal,
      onOutcome: () => Promise.resolve(),
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
