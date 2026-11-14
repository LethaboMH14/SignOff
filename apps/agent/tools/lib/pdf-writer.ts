/**
 * Writes a small text PDF with the standard Helvetica font. It is used to build the labelled invoice set and the tests.
 * The output has no dates, identifiers or random parts, so the same input always gives the same bytes, which keeps
 * each fixture's fingerprint stable. Text is limited to printable ASCII, so no font encoding is involved.
 */

const LINES_PER_PAGE = 48;
const FIRST_BASELINE = 790;
const LINE_SPACING = 16;

function escapePdfString(line: string): string {
  let escaped = '';
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) {
      throw new RangeError('only printable ASCII can be written into a fixture PDF');
    }
    if (character === '\\' || character === '(' || character === ')') {
      escaped += `\\${character}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}

function contentOf(lines: readonly string[]): string {
  if (lines.length > LINES_PER_PAGE) {
    throw new RangeError(`a fixture page holds at most ${String(LINES_PER_PAGE)} lines`);
  }
  return lines
    .map((line, index) => {
      const baseline = FIRST_BASELINE - index * LINE_SPACING;
      return `BT /F1 11 Tf 50 ${String(baseline)} Td (${escapePdfString(line)}) Tj ET`;
    })
    .join('\n');
}

/** Builds a PDF with one page per array of lines. Each line becomes one text object on its page. */
export function writeTextPdf(pages: readonly (readonly string[])[]): Buffer {
  if (pages.length === 0) {
    throw new RangeError('a PDF needs at least one page');
  }
  const fontNumber = 3 + pages.length * 2;
  const kids = pages.map((_, index) => `${String(3 + index * 2)} 0 R`).join(' ');
  const objects = new Map<number, string>([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`],
    [
      fontNumber,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ],
  ]);
  pages.forEach((lines, index) => {
    const pageNumber = 3 + index * 2;
    const contentNumber = 4 + index * 2;
    const content = contentOf(lines);
    objects.set(
      pageNumber,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(fontNumber)} 0 R >> >> /Contents ${String(contentNumber)} 0 R >>`,
    );
    objects.set(
      contentNumber,
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );
  });

  const count = fontNumber;
  let output = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
  const offsets: number[] = [];
  for (let number = 1; number <= count; number += 1) {
    const body = objects.get(number);
    if (body === undefined) {
      throw new Error('internal error: a PDF object is missing');
    }
    offsets.push(output.length);
    output = Buffer.concat([
      output,
      Buffer.from(`${String(number)} 0 obj\n${body}\nendobj\n`, 'latin1'),
    ]);
  }
  const xrefOffset = output.length;
  let trailer = `xref\n0 ${String(count + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    trailer += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${String(count + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.concat([output, Buffer.from(trailer, 'latin1')]);
}
