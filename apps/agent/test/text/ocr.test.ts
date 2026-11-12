/* eslint-disable security/detect-object-injection -- pixel buffers are indexed by bounded loop counters */
/* eslint-disable security/detect-non-literal-fs-filename -- the tests create their own folders */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Jimp, loadFont } from 'jimp';
import { SANS_32_BLACK } from 'jimp/fonts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { characterErrorRate } from '../../src/text/cer.js';
import { createOcrRecogniser, OCR_ENGINE, OcrError, TESSDATA_DIR } from '../../src/text/ocr.js';
import { greyFromRgba, rotateGrey } from '../../src/text/preprocess.js';

const LINES = ['Invoice number: INV-TST-0100', 'Currency: ZAR', 'Total due: 1500.00'];
const OCR_TIMEOUT_MS = 120_000;

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'signoff-ocr-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function renderPng(lines: readonly string[]): Promise<Buffer> {
  const font = await loadFont(SANS_32_BLACK);
  const image = new Jimp({ width: 1240, height: 400, color: 0xffffffff });
  lines.forEach((line, index) => image.print({ font, x: 80, y: 80 + index * 60, text: line }));
  return Buffer.from(await image.getBuffer('image/png'));
}

describe('the pinned OCR engine', () => {
  it('is pinned to an exact Tesseract.js version', () => {
    expect(OCR_ENGINE).toEqual({ package: 'tesseract.js', version: '7.0.0' });
  });

  it('ships the English and Afrikaans language data with hashes in its manifest', () => {
    const manifest = JSON.parse(readFileSync(join(TESSDATA_DIR, 'manifest.json'), 'utf8')) as {
      files: { name: string; sha256: string }[];
    };
    expect(manifest.files.map((file) => file.name).sort()).toEqual([
      'afr.traineddata.gz',
      'eng.traineddata.gz',
    ]);
  });
});

describe('recognition with the vendored data', () => {
  const recogniser = createOcrRecogniser();

  afterAll(async () => {
    await recogniser.close();
  });

  it(
    'reads a rendered invoice page word for word, and reports its confidence and language set',
    async () => {
      const reading = await recogniser.recognise(await renderPng(LINES), 'PNG', 'eng+afr');
      expect(reading.languages).toBe('eng+afr');
      expect(characterErrorRate(LINES.join('\n'), reading.text)).toBe(0);
      expect(reading.confidence).toBeGreaterThan(70);
      expect(reading.correctedDegrees).toBe(0);
    },
    OCR_TIMEOUT_MS,
  );

  it(
    'corrects a page turned by 2 degrees before it reads the page',
    async () => {
      // The page is turned with the module's own rotation over white paper, then encoded as a PNG.
      const straight = await Jimp.read(await renderPng(LINES));
      const { width, height, data } = straight.bitmap;
      const grey = greyFromRgba(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        width,
        height,
      );
      const turned = rotateGrey(grey, 2);
      const out = new Jimp({ width, height, color: 0xffffffff });
      for (let index = 0; index < width * height; index += 1) {
        const value = turned.data[index] ?? 255;
        out.bitmap.data[index * 4] = value;
        out.bitmap.data[index * 4 + 1] = value;
        out.bitmap.data[index * 4 + 2] = value;
      }
      const reading = await recogniser.recognise(
        Buffer.from(await out.getBuffer('image/png')),
        'PNG',
        'eng',
      );
      expect(reading.correctedDegrees).toBeCloseTo(2, 6);
      expect(characterErrorRate(LINES.join('\n'), reading.text)).toBeLessThan(0.1);
    },
    OCR_TIMEOUT_MS,
  );

  it(
    'refuses an image that is not a readable PNG under its header',
    async () => {
      const header = Buffer.alloc(40);
      header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      header.writeUInt32BE(13, 8);
      header.write('IHDR', 12, 'latin1');
      header.writeUInt32BE(200, 16);
      header.writeUInt32BE(100, 20);
      await expect(recogniser.recognise(header, 'PNG', 'eng')).rejects.toMatchObject({
        reason: 'OCR_IMAGE_UNREADABLE',
      });
    },
    OCR_TIMEOUT_MS,
  );
});

describe('fail closed when the language data is not the data that was pinned', () => {
  it('stops with a named reason when the data folder has no language files', async () => {
    const empty = join(scratch, 'empty');
    mkdirSync(empty);
    const recogniser = createOcrRecogniser(empty);
    const rejection = await recogniser
      .recognise(await renderPng(LINES), 'PNG', 'eng')
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(OcrError);
    expect((rejection as OcrError).reason).toBe('OCR_LANGUAGE_DATA_MISSING');
  });

  it(
    'stops with a named reason when a language file no longer matches its pinned hash',
    async () => {
      const altered = join(scratch, 'altered');
      mkdirSync(altered);
      copyFileSync(join(TESSDATA_DIR, 'manifest.json'), join(altered, 'manifest.json'));
      copyFileSync(join(TESSDATA_DIR, 'afr.traineddata.gz'), join(altered, 'afr.traineddata.gz'));
      const original = readFileSync(join(TESSDATA_DIR, 'eng.traineddata.gz'));
      const changed = Buffer.from(original);
      changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 0xff;
      writeFileSync(join(altered, 'eng.traineddata.gz'), changed);
      const recogniser = createOcrRecogniser(altered);
      const rejection = await recogniser
        .recognise(await renderPng(LINES), 'PNG', 'eng')
        .catch((error: unknown) => error);
      expect((rejection as OcrError).reason).toBe('OCR_LANGUAGE_DATA_MISMATCH');
      // The refusal is remembered: a second page gets the same answer without a second check.
      const again = await recogniser
        .recognise(await renderPng(LINES), 'PNG', 'eng')
        .catch((error: unknown) => error);
      expect((again as OcrError).reason).toBe('OCR_LANGUAGE_DATA_MISMATCH');
    },
    OCR_TIMEOUT_MS,
  );
});
