/* eslint-disable security/detect-non-literal-fs-filename -- the tests create their own folders */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  extractPdfText,
  MAX_CHILD_OUTPUT_BYTES,
  PDF_TIMEOUT_MS,
} from '../../src/intake/pdf-text.js';
import { normaliseText } from '../../src/text/normalise.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'signoff-pdf-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function script(name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

describe('extractPdfText', () => {
  it('reads the text of every page of a text PDF', async () => {
    const bytes = writeTextPdf([
      ['Invoice number: INV-TST-0001 (A)', 'Total due: R 12 345,67'],
      ['Page two: Purchase order PO-TST-0001'],
    ]);
    const result = await extractPdfText(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(2);
    expect(normaliseText(result.pages[0] ?? '')).toBe(
      'Invoice number: INV-TST-0001 (A) Total due: R 12 345,67',
    );
    expect(normaliseText(result.pages[1] ?? '')).toBe('Page two: Purchase order PO-TST-0001');
  });

  it('reports unreadable bytes as unreadable, not as a crash', async () => {
    const result = await extractPdfText(Buffer.from('%PDF-1.4 this is not a real document'));
    expect(result).toEqual({ ok: false, reason: 'UNREADABLE' });
  });

  it('reports a child that exits with an error as a failed extraction', async () => {
    const path = script('exit-three.mjs', 'process.exit(3);\n');
    const result = await extractPdfText(Buffer.from('x'), { script: path });
    expect(result).toEqual({ ok: false, reason: 'EXTRACTION_FAILED' });
  });

  it('stops a child that runs past the time limit', async () => {
    const path = script('sleep.mjs', 'setTimeout(() => {}, 60000);\n');
    const started = Date.now();
    const result = await extractPdfText(Buffer.from('x'), { script: path, timeoutMs: 300 });
    expect(result).toEqual({ ok: false, reason: 'EXTRACTION_FAILED' });
    expect(Date.now() - started).toBeLessThan(PDF_TIMEOUT_MS);
  });

  it('stops a child whose output is too large', async () => {
    const big = `process.stdout.write('x'.repeat(${String(MAX_CHILD_OUTPUT_BYTES + 1024)}));\n`;
    const path = script('flood.mjs', big);
    const result = await extractPdfText(Buffer.from('x'), { script: path, timeoutMs: 20_000 });
    expect(result).toEqual({ ok: false, reason: 'EXTRACTION_FAILED' });
  });

  it('refuses output that is not JSON', async () => {
    const path = script('not-json.mjs', "process.stdout.write('hello');\n");
    expect(await extractPdfText(Buffer.from('x'), { script: path })).toEqual({
      ok: false,
      reason: 'EXTRACTION_FAILED',
    });
  });

  it('refuses output that does not match the answer shape', async () => {
    const path = script('bad-shape.mjs', 'process.stdout.write(\'{"ok":true,"pages":[1]}\');\n');
    expect(await extractPdfText(Buffer.from('x'), { script: path })).toEqual({
      ok: false,
      reason: 'EXTRACTION_FAILED',
    });
  });

  it('passes a failure reason from the child through', async () => {
    const path = script(
      'too-many.mjs',
      "process.stdout.write(JSON.stringify({ ok: false, reason: 'TOO_MANY_PAGES' }));\n",
    );
    expect(await extractPdfText(Buffer.from('x'), { script: path })).toEqual({
      ok: false,
      reason: 'TOO_MANY_PAGES',
    });
  });

  it('reports a child that cannot be started as a failed extraction', async () => {
    const result = await extractPdfText(Buffer.from('x'), {
      script: join(dir, 'missing-script.mjs'),
    });
    expect(result).toEqual({ ok: false, reason: 'EXTRACTION_FAILED' });
  });
});
