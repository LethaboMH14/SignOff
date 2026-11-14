/* eslint-disable security/detect-object-injection -- pixel buffers are indexed by loop counters bounded by width and height; every read has a ?? default */
/**
 * Image pre-processing for OCR, written as pure functions over an 8-bit grey raster. The decoder and the encoder live
 * in ocr.ts; nothing here reads a file or calls a library, so each step can be tested on its own.
 *
 * Steps: Otsu threshold (choose the grey level that best separates ink from paper), projection-profile skew estimate
 * (the angle at which dark pixels pile into the fewest rows), and nearest-neighbour rotation to correct that skew.
 */

export interface GreyImage {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel, row by row, 0 = black and 255 = white. */
  readonly data: Uint8Array;
}

/** The largest skew, in degrees, that is corrected. A scan tilted further is not an invoice that was placed on a scanner. */
export const MAX_SKEW_DEGREES = 5;
/** Angle step for the skew search. Finer steps cost time without changing the result on invoice text. */
export const SKEW_STEP_DEGREES = 0.25;

/** The grey level that maximises between-class variance (Otsu, 1979). Ties go to the lower level, so the answer is fixed. */
export function otsuThreshold(data: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of data) {
    histogram[value] = (histogram[value] ?? 0) + 1;
  }
  const total = data.length;
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) {
    sumAll += level * (histogram[level] ?? 0);
  }
  let sumBelow = 0;
  let weightBelow = 0;
  let bestLevel = 0;
  let bestVariance = -1;
  for (let level = 0; level < 256; level += 1) {
    weightBelow += histogram[level] ?? 0;
    if (weightBelow === 0) {
      continue;
    }
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) {
      break;
    }
    sumBelow += level * (histogram[level] ?? 0);
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sumAll - sumBelow) / weightAbove;
    const variance = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestLevel = level;
    }
  }
  return bestLevel;
}

/**
 * The skew of the text in degrees, between -MAX_SKEW_DEGREES and +MAX_SKEW_DEGREES. The image's content is taken to be
 * rotated by the returned angle. The score is the sum of squared row counts for ink pixels projected onto the normal of
 * each candidate direction; a sharp row profile means the lines run along that direction. Angles are scanned in a fixed
 * order and only a strictly better score replaces the best, so the result is the same on every run.
 */
export function estimateSkewDegrees(image: GreyImage, threshold: number): number {
  const { width, height, data } = image;
  const xs: number[] = [];
  const ys: number[] = [];
  // Every ink pixel is used. A sparser grid lines up with the axes, so the score would favour angle 0 for the grid's
  // own sake, not for the text; measured on a 1.5 degree page, sampling every second pixel gave a false peak at 0.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // The threshold is the last grey level that counts as ink, so a pixel at or below it is ink.
      if ((data[y * width + x] ?? 255) <= threshold) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length === 0) {
    return 0;
  }
  const bins = Math.ceil(Math.hypot(width, height)) * 2 + 4;
  const offset = bins / 2;
  let bestAngle = 0;
  let bestScore = -1;
  const steps = Math.round((2 * MAX_SKEW_DEGREES) / SKEW_STEP_DEGREES);
  for (let step = 0; step <= steps; step += 1) {
    const angle = -MAX_SKEW_DEGREES + step * SKEW_STEP_DEGREES;
    const radians = (angle * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    const counts = new Int32Array(bins);
    for (let index = 0; index < xs.length; index += 1) {
      const x = xs[index] ?? 0;
      const y = ys[index] ?? 0;
      const projected = Math.floor(-x * sin + y * cos + offset);
      counts[projected] = (counts[projected] ?? 0) + 1;
    }
    let score = 0;
    for (const count of counts) {
      score += count * count;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  // Round away floating-point noise so the same image always reports the same number.
  return Math.round(bestAngle * 1000) / 1000;
}

/**
 * Rotates the content of the image by `degrees` about its centre, keeping its size. Positions that fall outside the
 * source become white paper. Nearest-neighbour sampling is used: it adds no grey levels that could be read as text.
 */
export function rotateGrey(image: GreyImage, degrees: number): GreyImage {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height).fill(255);
  if (degrees === 0) {
    out.set(data);
    return { width, height, data: out };
  }
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Inverse mapping: for each output pixel, the source pixel it takes its grey level from.
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cx + dx * cos + dy * sin);
      const sy = Math.round(cy - dx * sin + dy * cos);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        out[y * width + x] = data[sy * width + sx] ?? 255;
      }
    }
  }
  return { width, height, data: out };
}

/** Grey from RGBA: the Rec. 601 luma weights, rounded. */
export function greyFromRgba(rgba: Uint8Array, width: number, height: number): GreyImage {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const r = rgba[index * 4] ?? 255;
    const g = rgba[index * 4 + 1] ?? 255;
    const b = rgba[index * 4 + 2] ?? 255;
    data[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { width, height, data };
}

export interface PreparedImage {
  readonly image: GreyImage;
  readonly threshold: number;
  /** The skew that was corrected, in degrees. 0 when the page was already straight. */
  readonly correctedDegrees: number;
}

/** The whole chain for one page: grey, skew estimate, rotation to correct it, and the threshold for ink. */
export function prepareGrey(image: GreyImage): PreparedImage {
  const threshold = otsuThreshold(image.data);
  const skew = estimateSkewDegrees(image, threshold);
  const corrected = skew === 0 ? image : rotateGrey(image, -skew);
  return { image: corrected, threshold, correctedDegrees: skew };
}
