// Seeded, dependency-free random numbers. Every file gets its own stream, derived from its id,
// so the output does not depend on iteration order (doctrine 5: determinism is correctness).
import { createHash } from 'node:crypto';

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** FNV-1a 32-bit hash of a string, used to turn a file id into a seed. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and fully determined by its seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      if (max < min) throw new RangeError(`int(${String(min)}, ${String(max)}): empty range`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() on an empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}

/** Rng for one named artefact, e.g. "SUP-GEN-001/clean-full/0". */
export function rngFor(id: string): Rng {
  return createRng(seedFrom(id));
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
