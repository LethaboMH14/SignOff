/* eslint-disable security/detect-non-literal-fs-filename -- the tests create their own folders */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import {
  intakeFile,
  listInbox,
  MAX_INVOICE_BYTES,
  scanOnce,
  watchInbox,
  type IntakeOutcome,
} from '../../src/intake/intake.js';
import type { PdfTextResult } from '../../src/intake/pdf-text.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signoff-intake-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const TEXT_LINES = ['Invoice number: INV-TST-0100', 'Total due: 1500.00', 'Currency: ZAR'];

function write(name: string, bytes: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

describe('intakeFile', () => {
  it('accepts a text PDF and fingerprints its bytes', async () => {
    const bytes = writeTextPdf([TEXT_LINES]);
    const outcome = await intakeFile(write('a.pdf', bytes));
    expect(outcome.kind).toBe('text-pdf');
    if (outcome.kind !== 'text-pdf') return;
    expect(outcome.fingerprint).toBe(sha256OfBytes(bytes));
    expect(outcome.bytes).toBe(bytes.length);
    expect(outcome.pages.join(' ')).toContain('INV-TST-0100');
  });

  it('holds a file that is not a PDF, and still fingerprints it', async () => {
    const bytes = Buffer.from('Invoice number: INV-TST-0100 in plain text');
    const outcome = await intakeFile(write('a.txt', bytes));
    expect(outcome).toEqual({
      kind: 'held',
      fingerprint: sha256OfBytes(bytes),
      bytes: bytes.length,
      reason: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it('holds a PDF with no text layer, as a scan would be', async () => {
    const outcome = await intakeFile(write('scan.pdf', writeTextPdf([['   ']])));
    expect(outcome).toMatchObject({ kind: 'held', reason: 'NO_TEXT_LAYER' });
  });

  it('holds a PDF that cannot be parsed', async () => {
    const outcome = await intakeFile(write('bad.pdf', '%PDF-1.4 garbage'));
    expect(outcome).toMatchObject({ kind: 'held', reason: 'PDF_UNREADABLE' });
  });

  it('maps each extractor failure to its own hold reason', async () => {
    const cases: readonly [PdfTextResult, string][] = [
      [{ ok: false, reason: 'ENCRYPTED' }, 'PDF_ENCRYPTED'],
      [{ ok: false, reason: 'UNREADABLE' }, 'PDF_UNREADABLE'],
      [{ ok: false, reason: 'TOO_MANY_PAGES' }, 'PDF_TOO_MANY_PAGES'],
      [{ ok: false, reason: 'EXTRACTION_FAILED' }, 'PDF_EXTRACTION_FAILED'],
    ];
    for (const [result, reason] of cases) {
      const outcome = await intakeFile(write(`${reason}.pdf`, '%PDF-1.4 x'), () =>
        Promise.resolve(result),
      );
      expect(outcome).toMatchObject({ kind: 'held', reason });
    }
  });

  it('holds a file larger than the limit without reading it', async () => {
    const path = write('huge.pdf', Buffer.alloc(MAX_INVOICE_BYTES + 1, 0x20));
    const outcome = await intakeFile(path);
    expect(outcome).toEqual({
      kind: 'held',
      fingerprint: null,
      bytes: MAX_INVOICE_BYTES + 1,
      reason: 'FILE_TOO_LARGE',
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
  it('handles each file once, and skips a re-sent copy with the same fingerprint', async () => {
    const bytes = writeTextPdf([TEXT_LINES]);
    write('first.pdf', bytes);
    write('copy.pdf', bytes);
    write('note.txt', 'not a pdf');
    const seen = new Set<string>();
    const handled: IntakeOutcome[] = [];
    const options = {
      dir,
      seen,
      onOutcome: (_key: string, _path: string, outcome: IntakeOutcome) => {
        handled.push(outcome);
        return Promise.resolve();
      },
    };

    expect(await scanOnce(options)).toBe(2);
    expect(handled.map((outcome) => outcome.kind)).toEqual(['text-pdf', 'held']);
    expect(await scanOnce(options)).toBe(0);
    expect(handled).toHaveLength(2);
  });

  it('keys a file it could not fingerprint by its path, so it is reported once', async () => {
    mkdirSync(join(dir, 'folder'));
    const seen = new Set<string>();
    const reports: string[] = [];
    const options = {
      dir,
      seen,
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
    await watchInbox({
      dir,
      seen: new Set<string>(),
      intervalMs: 60_000,
      signal: controller.signal,
      onOutcome: () => Promise.resolve(),
    });
  });

  it('wakes from its wait when the signal is aborted during the pause', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const run = watchInbox({
      dir,
      seen: new Set<string>(),
      intervalMs: 60_000,
      signal: controller.signal,
      onOutcome: () => Promise.resolve(),
    });
    setTimeout(() => {
      controller.abort();
    }, 20);
    await run;
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
