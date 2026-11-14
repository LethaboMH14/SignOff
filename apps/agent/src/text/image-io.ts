/* eslint-disable security/detect-object-injection -- pixel buffers are indexed by bounded loop counters, each with a ?? default */
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

import type { GreyImage } from './preprocess.js';

/**
 * Decodes and encodes the two image formats the agent reads. Both decoders are pure JavaScript with no dependencies:
 * pngjs (MIT) for PNG and jpeg-js (BSD-3-Clause) for JPEG. Pixels come out as RGBA, eight bits a channel.
 */

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Four bytes a pixel: red, green, blue, alpha. */
  readonly rgba: Uint8Array;
}

/** Decodes a PNG or JPEG. Throws when the bytes are not a valid image of that format. */
export function decodeImage(bytes: Uint8Array, format: 'PNG' | 'JPEG'): RgbaImage {
  if (format === 'PNG') {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
  }
  const decoded = jpeg.decode(Buffer.from(bytes), { useTArray: true });
  return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
}

/** Encodes a grey raster as a PNG. Each grey level is written to all three colour channels, with full alpha. */
export function encodeGreyPng(image: GreyImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  for (let index = 0; index < image.width * image.height; index += 1) {
    const value = image.data[index] ?? 255;
    png.data[index * 4] = value;
    png.data[index * 4 + 1] = value;
    png.data[index * 4 + 2] = value;
    png.data[index * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}
