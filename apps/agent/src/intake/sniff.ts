/**
 * Format sniffing. The file's first bytes decide what it is, and its extension must agree, so a renamed file is held.
 * Nothing here parses a document: each format is recognised from its signature and, for images, its header size.
 */

export type SniffedFormat =
  | 'EMPTY'
  | 'PDF'
  | 'PNG'
  | 'JPEG'
  | 'HEIC'
  | 'DOCX'
  | 'XLSX'
  | 'ZIP'
  | 'UBL_XML'
  | 'XML'
  | 'UNKNOWN';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** A page or photo larger than this is held before any decoder runs (a decompression-bomb guard). */
export const MAX_IMAGE_SIDE = 6_000;
export const MAX_IMAGE_PIXELS = 25_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const UBL_NAMESPACE = 'urn:oasis:names:specification:ubl';

export function sniffFormat(bytes: Uint8Array): SniffedFormat {
  if (bytes.length === 0) {
    return 'EMPTY';
  }
  const head = Buffer.from(bytes.subarray(0, 12)).toString('latin1');
  if (head.startsWith('%PDF-')) {
    return 'PDF';
  }
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE)) {
    return 'PNG';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'JPEG';
  }
  if (head.slice(4, 8) === 'ftyp' && HEIC_BRANDS.has(head.slice(8, 12))) {
    return 'HEIC';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    // A zip container names its parts in the clear, so the Office package kind is read from those names.
    const names = Buffer.from(bytes).toString('latin1');
    if (names.includes('word/')) {
      return 'DOCX';
    }
    if (names.includes('xl/')) {
      return 'XLSX';
    }
    return 'ZIP';
  }
  const start = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096)))
    .toString('utf8')
    .trimStart();
  if (start.startsWith('<?xml') || start.startsWith('<')) {
    return Buffer.from(bytes).toString('utf8').includes(UBL_NAMESPACE) ? 'UBL_XML' : 'XML';
  }
  return 'UNKNOWN';
}

/** The pixel size from a PNG or JPEG header, or null when the header does not give one. */
export function imageSizeOf(format: 'PNG' | 'JPEG', bytes: Uint8Array): ImageSize | null {
  if (format === 'PNG') {
    if (bytes.length < 24) {
      return null;
    }
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
  }
  // JPEG: walk the marker segments to the first start-of-frame, which carries the height and width.
  /* eslint-disable security/detect-object-injection -- marker walk: every index is bounded by the loop condition or ?? 0 */
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { width, height };
    }
    if (length < 2) {
      return null;
    }
    offset += 2 + length;
  }
  /* eslint-enable security/detect-object-injection */
  return null;
}

export type FormatHold =
  | 'EMPTY_FILE'
  | 'FORMAT_HEIC_NOT_PARSED'
  | 'FORMAT_DOCX_NOT_PARSED'
  | 'FORMAT_XLSX_NOT_PARSED'
  | 'FORMAT_UBL_XML_NOT_PARSED'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'MIME_EXTENSION_MISMATCH';

/**
 * The hold for a sniffed format and a file name, or null when the agent reads that format. Formats it recognises but
 * does not parse are held with their own reason. An unknown format is held as unsupported. A readable format under the
 * wrong extension is held as a mismatch.
 */
export function formatHoldOf(format: SniffedFormat, fileName: string): FormatHold | null {
  switch (format) {
    case 'EMPTY':
      return 'EMPTY_FILE';
    case 'HEIC':
      return 'FORMAT_HEIC_NOT_PARSED';
    case 'DOCX':
      return 'FORMAT_DOCX_NOT_PARSED';
    case 'XLSX':
      return 'FORMAT_XLSX_NOT_PARSED';
    case 'UBL_XML':
      return 'FORMAT_UBL_XML_NOT_PARSED';
    case 'XML':
    case 'ZIP':
    case 'UNKNOWN':
      return 'UNSUPPORTED_FILE_TYPE';
    case 'PDF':
      return extensionOf(fileName) === '.pdf' ? null : 'MIME_EXTENSION_MISMATCH';
    case 'PNG':
      return extensionOf(fileName) === '.png' ? null : 'MIME_EXTENSION_MISMATCH';
    case 'JPEG':
      return ['.jpg', '.jpeg'].includes(extensionOf(fileName)) ? null : 'MIME_EXTENSION_MISMATCH';
  }
}

/** The lower-case extension with its dot, or an empty string. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot).toLowerCase();
}
