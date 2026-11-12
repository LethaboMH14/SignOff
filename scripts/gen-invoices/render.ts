// Renderers for the four forms. Text PDF uses PDFKit (text layer, standard Helvetica). Scanned and
// phone-photo forms rasterise the same SVG with sharp, then add degradation with seeded noise.
// Phone photos use an affine skew, not a true perspective transform: a deliberate approximation,
// stated in docs/DATA.md.
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { createRng, seedFrom, type Rng } from './prng.js';
import { PAGE_HEIGHT, PAGE_WIDTH, runsToSvg, type Run } from './layout.js';

/** A fixed creation time, so PDF bytes do not change between runs. */
export const FIXED_CREATION_DATE = new Date(Date.UTC(2026, 10, 1, 0, 0, 0));
const RASTER_DENSITY = 150;

export interface PdfInfo {
  title: string;
  subject?: string;
  keywords?: string;
  creator: string;
}

function pdfBytes(
  build: (doc: InstanceType<typeof PDFDocument>) => void,
  info: PdfInfo,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: info.title,
        Subject: info.subject ?? '',
        Keywords: info.keywords ?? '',
        Creator: info.creator,
        Producer: 'signoff-gen-invoices',
        CreationDate: FIXED_CREATION_DATE,
        ModDate: FIXED_CREATION_DATE,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Draws runs on the current PDFKit page. Baseline is corrected for Helvetica's ascent. */
export function drawRuns(doc: InstanceType<typeof PDFDocument>, runs: Run[]): void {
  for (const run of runs) {
    if (run.kind === 'rect') {
      doc.save().rect(run.x, run.y, run.w, run.h).fill(run.fill).restore();
    } else if (run.kind === 'line') {
      doc
        .save()
        .moveTo(run.x1, run.y1)
        .lineTo(run.x2, run.y2)
        .lineWidth(run.width)
        .strokeColor(run.color)
        .stroke()
        .restore();
    } else {
      doc
        .font(run.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(run.size)
        .fillColor(run.color ?? '#1d1d1f');
      const width = doc.widthOfString(run.text);
      const x = run.align === 'right' ? run.x - width : run.x;
      doc.text(run.text, x, run.y - run.size * 0.78, { lineBreak: false, width: width + 2 });
    }
  }
}

/** Text PDF: real text layer, the form most extractors meet first. */
export function renderTextPdf(runs: Run[], info: PdfInfo): Promise<Buffer> {
  return pdfBytes((doc) => {
    drawRuns(doc, runs);
  }, info);
}

/** Rasterises the runs to a page image at 150 dpi (1240 x 1754 px). */
export async function rasterisePage(runs: Run[]): Promise<Buffer> {
  return sharp(Buffer.from(runsToSvg(runs)), { density: RASTER_DENSITY })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}

/** Grey speckle and grain as raw single-channel pixels, multiplied over the page like scanner dust. */
function noiseRaw(width: number, height: number, rng: Rng): Buffer {
  const pixels = Array.from({ length: width * height }, () => {
    const grain = rng.int(0, 9);
    return rng.next() < 0.002 ? rng.int(150, 200) : 246 + Math.floor(grain / 2);
  });
  return Buffer.from(pixels);
}

/** Scanned PDF: greyscale, slight rotation, scanner noise, JPEG inside a one-page PDF. */
export async function renderScanPdf(runs: Run[], info: PdfInfo, seed: string): Promise<Buffer> {
  const rng = createRng(seedFrom(seed));
  const page = await rasterisePage(runs);
  const angle = (rng.next() * 2 - 1) * 1.2;
  const rotated = await sharp(page)
    .greyscale()
    .rotate(angle, { background: '#ffffff' })
    .toBuffer({ resolveWithObject: true });
  const width = rotated.info.width;
  const height = rotated.info.height;
  const grain = noiseRaw(width, height, rng);
  const scanned = await sharp(rotated.data)
    .composite([{ input: grain, raw: { width, height, channels: 1 }, blend: 'multiply' }])
    .jpeg({ quality: 72 })
    .toBuffer();
  return pdfBytes((doc) => {
    doc.image(scanned, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
  }, info);
}

/** Phone photo: the page on a dark table, rotated, skewed, shadowed, then JPEG or PNG. */
export async function renderPhoto(
  runs: Run[],
  format: 'png' | 'jpg',
  seed: string,
): Promise<Buffer> {
  const rng = createRng(seedFrom(seed));
  const page = await rasterisePage(runs);
  const angle = (rng.next() * 2 - 1) * 4;
  const shear = 0.015 + rng.next() * 0.02;
  const table = '#3b3834';
  const warped = await sharp(page)
    .rotate(angle, { background: table })
    .affine(
      [
        [1, shear],
        [shear * 0.35, 1],
      ],
      { background: table },
    )
    .toBuffer({ resolveWithObject: true });
  // Resize first: sharp applies resize before composite, so the overlay must match the final size.
  const scaled = await sharp(warped.data)
    .resize({ width: 1400 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const width = scaled.info.width;
  const height = scaled.info.height;
  // Soft shadow: a translucent dark layer over the whole frame, sized to the scaled frame.
  const shadow = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.2 } },
  })
    .png()
    .toBuffer();
  const pipeline = sharp(scaled.data).composite([{ input: shadow, blend: 'over' }]);
  return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: 84 }).toBuffer();
}

/** Plain text PDF for purchase orders and goods received notes. */
export function renderDocumentPdf(runs: Run[], info: PdfInfo): Promise<Buffer> {
  return renderTextPdf(runs, info);
}
