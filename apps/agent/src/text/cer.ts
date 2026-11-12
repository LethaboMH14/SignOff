/* eslint-disable security/detect-object-injection -- the edit-distance table is indexed by loop counters bounded by the two string lengths */
/**
 * Character error rate: the Levenshtein distance between the reference text and the reading, divided by the length of
 * the reference. Both sides are normalised first (composed Unicode, one space per run of white space), so a line break
 * is not counted as an error. Zero is a perfect reading. The value can exceed 1 when the reading is much longer.
 */
import { normaliseText } from './normalise.js';

export function characterErrorRate(reference: string, reading: string): number {
  // Array.from splits by code point, so an accented letter counts as one character on both sides.
  const truth = Array.from(normaliseText(reference));
  const hyp = Array.from(normaliseText(reading));
  if (truth.length === 0) {
    return hyp.length === 0 ? 0 : 1;
  }
  let previous = Array.from({ length: hyp.length + 1 }, (_, index) => index);
  for (let i = 1; i <= truth.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (truth[i - 1] === hyp[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1);
    }
    previous = current;
  }
  return (previous[hyp.length] ?? 0) / truth.length;
}
