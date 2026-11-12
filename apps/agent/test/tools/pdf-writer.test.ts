import { describe, expect, it } from 'vitest';

import { writeTextPdf } from '../../tools/lib/pdf-writer.js';

describe('writeTextPdf', () => {
  it('writes a PDF header and an end-of-file marker', () => {
    const bytes = writeTextPdf([['Hello']]);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(bytes.length - 6).toString('latin1')).toBe('%%EOF\n');
  });

  it('is deterministic, so the same lines always give the same fingerprint', () => {
    const first = writeTextPdf([['Invoice number: INV-1', 'Total: 10.00']]);
    const second = writeTextPdf([['Invoice number: INV-1', 'Total: 10.00']]);
    expect(first.equals(second)).toBe(true);
  });

  it('escapes parentheses and backslashes in the text', () => {
    const bytes = writeTextPdf([['Ref (A) \\ B']]);
    expect(bytes.toString('latin1')).toContain('(Ref \\(A\\) \\\\ B)');
  });

  it('rejects an empty document and text outside printable ASCII', () => {
    expect(() => writeTextPdf([])).toThrow('a PDF needs at least one page');
    expect(() => writeTextPdf([['café']])).toThrow(
      'only printable ASCII can be written into a fixture PDF',
    );
    expect(() => writeTextPdf([['tab\there']])).toThrow(
      'only printable ASCII can be written into a fixture PDF',
    );
  });

  it('rejects a page with too many lines', () => {
    const lines = Array.from({ length: 49 }, (_, index) => `line ${String(index)}`);
    expect(() => writeTextPdf([lines])).toThrow('a fixture page holds at most 48 lines');
  });

  it('writes a multi-page document with one content stream per page', () => {
    const bytes = writeTextPdf([['one'], ['two'], ['three']]);
    const text = bytes.toString('latin1');
    expect(text).toContain('/Count 3');
    expect(text).toContain('(one) Tj');
    expect(text).toContain('(two) Tj');
    expect(text).toContain('(three) Tj');
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(3);
  });
});
