/**
 * The motion timings, in milliseconds, from the D7 specification. Motion only adds emphasis: every state change is also
 * a text change. When the person asks the system for reduced motion, every duration here becomes zero.
 */

/** A card rises this many pixels and fades in. It never moves content off the screen. */
export const RISE_PX = 8;
export const RISE_MS = 400;
/** The delay between one card and the next in the opening sequence. */
export const STAGGER_MS = 60;
/** The KPI numbers climb to their values in this time. */
export const COUNT_UP_MS = 600;
/** Bars and limit fills grow in this time. */
export const FILL_MS = 450;
/** A screen crossfades, and a panel slides, in this time (the specification allows 180 to 220). */
export const TRANSITION_MS = 200;
/** A chip changes its colour and symbol in this time, together with its words. */
export const CHIP_CHANGE_MS = 150;
/** The password sheet slides up in this time. */
export const SHEET_MS = 240;
/** The opening sequence must finish within this time. */
export const OPENING_LIMIT_MS = 1200;
/** The number of tiles the opening sequence staggers. */
export const TILES_IN_OPENING = 6;

/** The duration to use: the given one, or zero when the person has asked for reduced motion. */
export function durationOf(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/**
 * The longest the opening sequence runs. The staggered rise of the last tile, the count-up and the fills start together,
 * so the sequence lasts as long as the longest of them.
 */
export function openingSequenceMs(): number {
  return Math.max((TILES_IN_OPENING - 1) * STAGGER_MS + RISE_MS, COUNT_UP_MS, FILL_MS);
}

/** Whether the person has asked the system for reduced motion. False where there is no window to ask. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
