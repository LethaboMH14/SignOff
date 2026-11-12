/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- the font is read from the agent's own assets folder; pixel buffers are indexed by bounded loop counters */
/**
 * Draws printed lines into a grey raster with a real outline font (Roboto Regular, SIL Open Font License 1.1, vendored
 * under assets/fonts). The outlines come from opentype.js; the fill is a scanline fill of the glyph outlines written
 * here. Glyphs are placed one at a time, because opentype's string shaping fails on this font's substitution table, so
 * kerning is not applied. A character the font does not draw is reported, never replaced silently.
 *
 * Ink is 0 (black) and paper is 255 (white). Samples are taken at pixel centres, with no anti-aliasing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import opentype, { type Glyph, type PathCommand } from 'opentype.js';

import type { GreyImage } from '../../src/text/preprocess.js';

const FONT_FILE = fileURLToPath(
  new URL('../../assets/fonts/roboto-latin-400-normal.woff', import.meta.url),
);

export interface PageLayout {
  readonly width: number;
  readonly height: number;
  /** Font size in pixels (em). Lines are drawn with their baselines this far below the top of each line box. */
  readonly fontSize: number;
  readonly marginX: number;
  readonly marginY: number;
  readonly lineHeight: number;
}

export interface RenderedPage {
  readonly image: GreyImage;
  /** Characters the font does not draw. A correct test text has none. */
  readonly unsupported: readonly string[];
}

interface Edge {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** +1 when the edge runs down the page, -1 when it runs up. */
  readonly direction: 1 | -1;
}

const CURVE_STEPS = 12;

let cachedFont: ReturnType<typeof opentype.parse> | null = null;

function loadFont(): ReturnType<typeof opentype.parse> {
  if (cachedFont === null) {
    const bytes = readFileSync(FONT_FILE);
    cachedFont = opentype.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return cachedFont;
}

/** Turns a glyph outline into straight edges. Curves are split into short chords. */
function edgesOf(commands: readonly PathCommand[]): Edge[] {
  const edges: Edge[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    if (y0 === y1) return;
    if (y0 < y1) {
      edges.push({ x0, y0, x1, y1, direction: 1 });
    } else {
      edges.push({ x0: x1, y0: y1, x1: x0, y1: y0, direction: -1 });
    }
  };
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        startX = command.x;
        startY = command.y;
        x = command.x;
        y = command.y;
        break;
      case 'L':
        add(x, y, command.x, command.y);
        x = command.x;
        y = command.y;
        break;
      case 'Q':
        for (let step = 1; step <= CURVE_STEPS; step += 1) {
          const t = step / CURVE_STEPS;
          const mt = 1 - t;
          const px = mt * mt * x + 2 * mt * t * command.x1 + t * t * command.x;
          const py = mt * mt * y + 2 * mt * t * command.y1 + t * t * command.y;
          add(x, y, px, py);
          x = px;
          y = py;
        }
        break;
      case 'C':
        for (let step = 1; step <= CURVE_STEPS; step += 1) {
          const t = step / CURVE_STEPS;
          const mt = 1 - t;
          const px =
            mt * mt * mt * x +
            3 * mt * mt * t * command.x1 +
            3 * mt * t * t * command.x2 +
            t * t * t * command.x;
          const py =
            mt * mt * mt * y +
            3 * mt * mt * t * command.y1 +
            3 * mt * t * t * command.y2 +
            t * t * t * command.y;
          add(x, y, px, py);
          x = px;
          y = py;
        }
        break;
      case 'Z':
        add(x, y, startX, startY);
        x = startX;
        y = startY;
        break;
    }
  }
  return edges;
}

/** Fills one glyph's outline into the page with the non-zero winding rule. */
function fillEdges(page: Uint8Array, width: number, height: number, edges: readonly Edge[]): void {
  if (edges.length === 0) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const edge of edges) {
    minY = Math.min(minY, edge.y0);
    maxY = Math.max(maxY, edge.y1);
  }
  const top = Math.max(0, Math.floor(minY));
  const bottom = Math.min(height - 1, Math.ceil(maxY));
  for (let row = top; row <= bottom; row += 1) {
    const sampleY = row + 0.5;
    const crossings: { x: number; direction: 1 | -1 }[] = [];
    for (const edge of edges) {
      if (sampleY < edge.y0 || sampleY >= edge.y1) continue;
      const t = (sampleY - edge.y0) / (edge.y1 - edge.y0);
      crossings.push({ x: edge.x0 + t * (edge.x1 - edge.x0), direction: edge.direction });
    }
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let index = 0; index < crossings.length - 1; index += 1) {
      winding += crossings[index]?.direction ?? 0;
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil((crossings[index]?.x ?? 0) - 0.5));
      const to = Math.min(width - 1, Math.ceil((crossings[index + 1]?.x ?? 0) - 0.5) - 1);
      for (let column = from; column <= to; column += 1) {
        page[row * width + column] = 0;
      }
    }
  }
}

/** Draws each line on a white page. Lines that do not fit the width are the caller's to wrap. */
export function renderPage(lines: readonly string[], layout: PageLayout): RenderedPage {
  const { width, height, fontSize, marginX, marginY, lineHeight } = layout;
  const font = loadFont();
  const scale = fontSize / font.unitsPerEm;
  const data = new Uint8Array(width * height).fill(255);
  const unsupported = new Set<string>();
  const glyphCache = new Map<string, Glyph>();
  lines.forEach((line, lineIndex) => {
    const baseline = marginY + lineIndex * lineHeight + fontSize;
    let pen = marginX;
    for (const character of line) {
      let glyph = glyphCache.get(character);
      if (glyph === undefined) {
        glyph = font.charToGlyph(character);
        glyphCache.set(character, glyph);
      }
      // Glyph 0 is the font's "missing" glyph. A space has its own glyph and is not missing.
      if (glyph.index === 0 && character !== ' ') {
        unsupported.add(character);
      } else {
        fillEdges(data, width, height, edgesOf(glyph.getPath(pen, baseline, fontSize).commands));
      }
      pen += (glyph.advanceWidth ?? 0) * scale;
    }
  });
  return { image: { width, height, data }, unsupported: [...unsupported].sort() };
}
