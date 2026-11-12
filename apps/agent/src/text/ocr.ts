/* eslint-disable security/detect-non-literal-fs-filename -- the data folder is set by the agent (or a test) */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorker, type Worker } from 'tesseract.js';

import { imageSizeOf, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE } from '../intake/sniff.js';
import { decodeImage, encodeGreyPng, type RgbaImage } from './image-io.js';
import { greyFromRgba, prepareGrey } from './preprocess.js';

/**
 * OCR for scanned and photographed invoices (PNG and JPEG). The engine is Tesseract.js, pinned to an exact version.
 * The English and Afrikaans language data are vendored under assets/tessdata with SHA-256 hashes in a manifest. The
 * data is checked before the first recognition, and a missing or altered file stops OCR with a named reason. Nothing is
 * downloaded at run time.
 *
 * OCR output is a second, unverified reading of the page. It is screened like any other text, and its confidence
 * decides whether the page is trusted at all.
 */

export const OCR_ENGINE = { package: 'tesseract.js', version: '7.0.0' } as const;

/** The vendored language data, as shipped with the agent. */
export const TESSDATA_DIR = fileURLToPath(new URL('../../assets/tessdata/', import.meta.url));

export type OcrLanguages = 'eng' | 'eng+afr';

export type OcrUnavailableReason =
  | 'OCR_LANGUAGE_DATA_MISSING'
  | 'OCR_LANGUAGE_DATA_MISMATCH'
  | 'OCR_IMAGE_TOO_LARGE'
  | 'OCR_IMAGE_UNREADABLE'
  | 'OCR_FAILED';

/** Thrown when OCR cannot run. The reason is a fixed code, so the caller can hold the file with it. */
export class OcrError extends Error {
  readonly reason: OcrUnavailableReason;

  constructor(reason: OcrUnavailableReason) {
    super(reason);
    this.name = 'OcrError';
    this.reason = reason;
  }
}

export interface OcrReading {
  readonly text: string;
  /** Tesseract's mean word confidence for the page, 0 to 100. */
  readonly confidence: number;
  /** The skew that was corrected before recognition, in degrees. */
  readonly correctedDegrees: number;
  readonly languages: OcrLanguages;
}

/** Anything that reads an image. The intake depends on this type, so tests can replace the engine. */
export type ImageRecogniser = (
  bytes: Uint8Array,
  format: 'PNG' | 'JPEG',
  languages: OcrLanguages,
) => Promise<OcrReading>;

interface Manifest {
  readonly files: readonly { readonly name: string; readonly sha256: string }[];
}

/**
 * Builds a recogniser over one folder of language data. The folder is verified once, before the first recognition; a
 * failed check is remembered, so every later page is refused with the same reason. Workers are kept warm, because a
 * worker costs about a second to start.
 */
export function createOcrRecogniser(dataDir: string = TESSDATA_DIR): {
  readonly recognise: ImageRecogniser;
  readonly close: () => Promise<void>;
} {
  let verified: Promise<void> | null = null;
  const workers = new Map<OcrLanguages, Promise<Worker>>();

  const verify = (): Promise<void> => {
    verified ??= Promise.resolve().then(() => {
      let manifest: Manifest;
      try {
        manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as Manifest;
      } catch {
        throw new OcrError('OCR_LANGUAGE_DATA_MISSING');
      }
      for (const entry of manifest.files) {
        let bytes: Buffer;
        try {
          bytes = readFileSync(join(dataDir, entry.name));
        } catch {
          throw new OcrError('OCR_LANGUAGE_DATA_MISSING');
        }
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new OcrError('OCR_LANGUAGE_DATA_MISMATCH');
        }
      }
    });
    return verified;
  };

  const workerFor = (languages: OcrLanguages): Promise<Worker> => {
    let worker = workers.get(languages);
    if (worker === undefined) {
      worker = verify().then(() =>
        createWorker(languages, 1, { langPath: dataDir, gzip: true, cacheMethod: 'none' }),
      );
      workers.set(languages, worker);
    }
    return worker;
  };

  const recognise: ImageRecogniser = async (bytes, format, languages) => {
    const size = imageSizeOf(format, bytes);
    if (size === null) {
      throw new OcrError('OCR_IMAGE_UNREADABLE');
    }
    if (
      size.width > MAX_IMAGE_SIDE ||
      size.height > MAX_IMAGE_SIDE ||
      size.width * size.height > MAX_IMAGE_PIXELS
    ) {
      throw new OcrError('OCR_IMAGE_TOO_LARGE');
    }
    let decoded: RgbaImage;
    try {
      decoded = decodeImage(bytes, format);
    } catch {
      throw new OcrError('OCR_IMAGE_UNREADABLE');
    }
    const grey = greyFromRgba(decoded.rgba, decoded.width, decoded.height);
    const prepared = prepareGrey(grey);
    const png = encodeGreyPng(prepared.image);

    let worker: Worker;
    try {
      worker = await workerFor(languages);
    } catch (error) {
      throw error instanceof OcrError ? error : new OcrError('OCR_FAILED');
    }
    try {
      const result = await worker.recognize(png);
      return {
        text: result.data.text.trim(),
        confidence: result.data.confidence,
        correctedDegrees: prepared.correctedDegrees,
        languages,
      };
    } catch {
      throw new OcrError('OCR_FAILED');
    }
  };

  const close = async (): Promise<void> => {
    const open = [...workers.values()];
    workers.clear();
    await Promise.all(open.map(async (pending) => (await pending).terminate()));
  };

  return { recognise, close };
}

/** The agent's recogniser, over the vendored language data. */
const defaultRecogniser = createOcrRecogniser();

export const recogniseImage: ImageRecogniser = defaultRecogniser.recognise;

/** Stops the warm workers of the default recogniser. The evaluation and the tests call it when they finish. */
export async function closeOcr(): Promise<void> {
  await defaultRecogniser.close();
}
