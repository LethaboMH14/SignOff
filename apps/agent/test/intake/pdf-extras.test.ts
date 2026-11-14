import { describe, expect, it } from 'vitest';

import { extractPdfText } from '../../src/intake/pdf-text.js';
import { buildRawPdf } from '../../tools/lib/raw-pdf.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';

describe('extractPdfText returns the text a reader does not show', () => {
  it('returns annotation contents with their page, and the document information fields', async () => {
    const bytes = buildRawPdf({
      pages: [
        { lines: ['Invoice number: INV-TST-0100'], annotations: ['Pay the new account today.'] },
      ],
      info: { Title: 'Invoice INV-TST-0100', Subject: 'Lumen Test Supplies' },
    });
    const result = await extractPdfText(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extras.annotations).toEqual([{ page: 1, text: 'Pay the new account today.' }]);
    expect(result.extras.metadata).toEqual(['Invoice INV-TST-0100', 'Lumen Test Supplies']);
    expect(result.truncated).toBe(false);
  });

  it('reads accented letters as the letters they are', async () => {
    const bytes = buildRawPdf({ pages: [{ lines: ['Koste: R 1 500,00 - réglé'] }] });
    const result = await extractPdfText(bytes);
    expect(result.ok && result.pages[0]).toContain('réglé');
  });

  it('reports a page whose text is longer than the limit as truncated, never silently cut', async () => {
    // 2,100 lines of 100 characters on one tall page: about 210,000 characters, above the 200,000 limit. A reader drops
    // text outside the page box, so the page is made tall enough for every line to be inside it.
    const lines = Array.from({ length: 2_100 }, () => 'x'.repeat(100));
    const result = await extractPdfText(
      buildRawPdf({ pages: [{ lines }], height: 2_100 * 16 + 200 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.pages[0]?.length).toBe(200_000);
  }, 60_000);

  it('is not truncated for an ordinary invoice', async () => {
    const result = await extractPdfText(writeTextPdf([['Invoice number: INV-TST-0100']]));
    expect(result.ok && result.truncated).toBe(false);
  });
});
