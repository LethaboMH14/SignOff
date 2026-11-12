/** The part of jpeg-js (0.4.4, BSD-3-Clause, no dependencies) that the agent uses. The package ships no typings. */
declare module 'jpeg-js' {
  export interface DecodedJpeg {
    readonly width: number;
    readonly height: number;
    /** RGBA pixels, four bytes a pixel, row by row. */
    readonly data: Uint8Array | Buffer;
  }

  export interface DecodeOptions {
    readonly useTArray?: boolean;
    readonly formatAsRGBA?: boolean;
    readonly maxMemoryUsageInMB?: number;
  }

  export function decode(buffer: Buffer | Uint8Array, options?: DecodeOptions): DecodedJpeg;

  const jpeg: { decode: typeof decode };
  export default jpeg;
}
