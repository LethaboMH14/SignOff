/** The part of opentype.js (2.0.0, MIT, no dependencies) that the test renderer uses. The package ships no typings. */
declare module 'opentype.js' {
  export type PathCommand =
    | { readonly type: 'M'; readonly x: number; readonly y: number }
    | { readonly type: 'L'; readonly x: number; readonly y: number }
    | {
        readonly type: 'Q';
        readonly x1: number;
        readonly y1: number;
        readonly x: number;
        readonly y: number;
      }
    | {
        readonly type: 'C';
        readonly x1: number;
        readonly y1: number;
        readonly x2: number;
        readonly y2: number;
        readonly x: number;
        readonly y: number;
      }
    | { readonly type: 'Z' };

  export interface Path {
    readonly commands: readonly PathCommand[];
  }

  export interface Glyph {
    readonly index: number;
    readonly advanceWidth: number | undefined;
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    readonly unitsPerEm: number;
    charToGlyph(character: string): Glyph;
  }

  export function parse(buffer: ArrayBuffer): Font;

  const opentype: { parse: typeof parse };
  export default opentype;
}
