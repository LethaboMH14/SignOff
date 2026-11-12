/* eslint-disable security/detect-object-injection -- indices are the loop counters of this builder, bounded by the page and annotation lists */
/**
 * Builds a PDF with the parts the labelled writer cannot: annotations, document information and coloured text. Each
 * string is written in WinAnsi, so accented letters (Afrikaans, French) reach the reader as the letters they are. The
 * output is deterministic: the same input always gives the same bytes. It is used only to build test fixtures.
 */

export interface RawPage {
  /** Lines drawn in black Helvetica, from the top of the page. */
  readonly lines: readonly string[];
  /** Lines drawn in white on white paper, so a reader does not see them. */
  readonly hiddenLines?: readonly string[];
  /** Text of annotations placed on the page (for example a sticky note's contents). */
  readonly annotations?: readonly string[];
}

export interface RawPdfOptions {
  readonly pages: readonly RawPage[];
  /** Document information fields, such as Title and Subject. */
  readonly info?: Readonly<Record<string, string>>;
  /**
   * The page height in points. A reader drops text outside the page box, so a page holding a very long text needs a tall
   * page. The default is an A4 height.
   */
  readonly height?: number;
}

/** A PDF string literal in WinAnsi. Characters above 0x7e are written as octal escapes, so the bytes stay ASCII. */
function literal(text: string): string {
  let out = '(';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0xff) {
      throw new RangeError('only WinAnsi characters can be written into a fixture PDF');
    }
    if (character === '\\' || character === '(' || character === ')') {
      out += `\\${character}`;
    } else if (code < 0x20 || code > 0x7e) {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    } else {
      out += character;
    }
  }
  return `${out})`;
}

function contentOf(page: RawPage, height: number): string {
  const lines: string[] = [];
  const top = height - 52;
  const draw = (text: string, y: number, colour: string) => {
    lines.push(`${colour} BT /F1 11 Tf 50 ${String(y)} Td ${literal(text)} Tj ET`);
  };
  page.lines.forEach((text, index) => {
    draw(text, top - index * 16, '0 0 0 rg');
  });
  (page.hiddenLines ?? []).forEach((text, index) => {
    draw(text, top - (page.lines.length + index) * 16, '1 1 1 rg');
  });
  return lines.join('\n');
}

export function buildRawPdf(options: RawPdfOptions): Buffer {
  const height = options.height ?? 842;
  // Object 1 is the catalogue, 2 the page tree, 3 the font. Then each page takes its page object, its content stream,
  // and one object per annotation. The information dictionary comes last when it exists.
  const pageObjectIds: number[] = [];
  const bodies: { id: number; body: string }[] = [];
  let next = 4;
  for (const page of options.pages) {
    const pageId = next;
    const contentId = next + 1;
    next += 2;
    const annotIds: number[] = [];
    annotIds.push(
      ...(page.annotations ?? []).map(() => {
        const id = next;
        next += 1;
        return id;
      }),
    );
    pageObjectIds.push(pageId);
    const content = contentOf(page, height);
    bodies.push({
      id: contentId,
      body: `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    });
    const annots =
      annotIds.length > 0
        ? ` /Annots [${annotIds.map((id) => `${String(id)} 0 R`).join(' ')}]`
        : '';
    bodies.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${String(height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentId)} 0 R${annots} >>`,
    });
    (page.annotations ?? []).forEach((text, index) => {
      bodies.push({
        id: annotIds[index] ?? 0,
        body: `<< /Type /Annot /Subtype /Text /Rect [50 700 70 720] /Contents ${literal(text)} >>`,
      });
    });
  }
  let infoId: number | null = null;
  if (options.info !== undefined) {
    infoId = next;
    next += 1;
    const fields = Object.entries(options.info)
      .map(([key, value]) => `/${key} ${literal(value)}`)
      .join(' ');
    bodies.push({ id: infoId, body: `<< ${fields} >>` });
  }

  const fixed: { id: number; body: string }[] = [
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    {
      id: 2,
      body: `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageObjectIds.length)} >>`,
    },
    {
      id: 3,
      body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    },
  ];
  const all = [...fixed, ...bodies].sort((a, b) => a.id - b.id);
  let out = '%PDF-1.4\n';
  const offsets = new Map<number, number>();
  for (const object of all) {
    offsets.set(object.id, Buffer.byteLength(out, 'latin1'));
    out += `${String(object.id)} 0 obj\n${object.body}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  const size = next;
  out += `xref\n0 ${String(size)}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    const offset = offsets.get(id) ?? 0;
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const info = infoId === null ? '' : ` /Info ${String(infoId)} 0 R`;
  out += `trailer\n<< /Size ${String(size)} /Root 1 0 R${info} >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
