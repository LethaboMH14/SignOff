/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- the tool reads its fixed fixture folder; pixel buffers are indexed by bounded loop counters */
/**
 * Measures OCR on rendered invoice pages. The reference text is the text layer of three labelled fixtures, read by the
 * same PDF parser the agent uses. Each page is drawn as an image with a bitmap font, once straight and once turned by
 * 1.5 degrees, and read back by the OCR module. The output is the character error rate and the run time per page, for
 * English alone and for English with Afrikaans. Nothing here is estimated: every number is a measured run.
 *
 * Run: npx tsx apps/agent/tools/measure-ocr.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadFont } from 'jimp';
import { SANS_32_BLACK } from 'jimp/fonts';
import { Jimp } from 'jimp';

import { extractPdfText } from '../src/intake/pdf-text.js';
import { characterErrorRate } from '../src/text/cer.js';
import { closeOcr, recogniseImage, type OcrLanguages } from '../src/text/ocr.js';
import { rotateGrey, type GreyImage } from '../src/text/preprocess.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'fixtures', 'labelled', 'invoices');
const FILES = ['clean-01.pdf', 'clean-02.pdf', 'clean-03.pdf'];
const WIDTH = 1240;
const LINE_HEIGHT = 40;
const MARGIN = 80;
const WRAP = 62;
const SKEW_DEGREES = 1.5;

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > WRAP && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

async function renderPage(
  text: string,
): Promise<{ straight: Buffer; turned: Buffer; degraded: Buffer; reference: string }> {
  const lines = wrap(text);
  const height = Math.max(1754, MARGIN * 2 + lines.length * LINE_HEIGHT);
  const font = await loadFont(SANS_32_BLACK);
  const image = new Jimp({ width: WIDTH, height, color: 0xffffffff });
  lines.forEach((line, index) => {
    image.print({ font, x: MARGIN, y: MARGIN + index * LINE_HEIGHT, text: line });
  });
  const grey: GreyImage = {
    width: WIDTH,
    height,
    data: new Uint8Array(WIDTH * height),
  };
  for (let index = 0; index < WIDTH * height; index += 1) {
    grey.data[index] = image.bitmap.data[index * 4] ?? 255;
  }
  const turned = rotateGrey(grey, SKEW_DEGREES);
  return {
    straight: await encodeGrey(grey),
    turned: await encodeGrey(turned),
    degraded: await encodeGrey(degrade(turned)),
    reference: text,
  };
}

/**
 * A scan-like degradation: paper turns grey, contrast falls, a 3 by 3 blur softens the strokes, and noise is added. The
 * noise comes from a fixed-seed generator, so the same page always gives the same image.
 */
function degrade(image: GreyImage): GreyImage {
  const { width, height, data } = image;
  let seed = 20261112;
  const noise = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            sum += data[sy * width + sx] ?? 255;
            count += 1;
          }
        }
      }
      const blurred = sum / count;
      const value = blurred * 0.8 + 40 + noise() * 18;
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { width, height, data: out };
}

async function encodeGrey(image: GreyImage): Promise<Buffer> {
  const out = new Jimp({ width: image.width, height: image.height, color: 0xffffffff });
  for (let index = 0; index < image.width * image.height; index += 1) {
    const value = image.data[index] ?? 255;
    out.bitmap.data[index * 4] = value;
    out.bitmap.data[index * 4 + 1] = value;
    out.bitmap.data[index * 4 + 2] = value;
  }
  return Buffer.from(await out.getBuffer('image/png'));
}

interface Row {
  readonly page: string;
  readonly languages: OcrLanguages;
  readonly cer: number;
  readonly confidence: number;
  readonly ms: number;
  readonly correctedDegrees: number;
  readonly referenceChars: number;
  readonly readingChars: number;
}

async function main(): Promise<void> {
  const pages: {
    name: string;
    reference: string;
    straight: Buffer;
    turned: Buffer;
    degraded: Buffer;
  }[] = [];
  for (const file of FILES) {
    const parsed = await extractPdfText(readFileSync(join(FIXTURES, file)));
    if (!parsed.ok) {
      throw new Error(`fixture ${file} did not parse`);
    }
    const rendered = await renderPage(parsed.pages.join('\n'));
    pages.push({ name: file, ...rendered });
  }

  const rows: Row[] = [];
  for (const languages of ['eng', 'eng+afr'] as const) {
    for (const page of pages) {
      for (const variant of ['straight', 'turned', 'degraded'] as const) {
        const started = performance.now();
        const reading = await recogniseImage(page[variant], 'PNG', languages);
        const ms = performance.now() - started;
        rows.push({
          page: `${page.name} (${variant})`,
          languages,
          cer: characterErrorRate(page.reference, reading.text),
          confidence: reading.confidence,
          ms,
          correctedDegrees: reading.correctedDegrees,
          referenceChars: page.reference.length,
          readingChars: reading.text.length,
        });
      }
    }
  }
  await closeOcr();

  const lines = [
    '| Page | Languages | Reference chars | Read chars | CER | Mean confidence | Run time (ms) | Corrected skew (deg) |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.page} | ${row.languages} | ${String(row.referenceChars)} | ${String(row.readingChars)} | ${row.cer.toFixed(4)} | ${row.confidence.toFixed(1)} | ${row.ms.toFixed(0)} | ${row.correctedDegrees.toFixed(3)} |`,
    ),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'the measurement failed'}\n`);
  process.exitCode = 1;
});
