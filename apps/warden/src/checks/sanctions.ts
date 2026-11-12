import { z } from 'zod';

import { hold, type Verdict } from '../checks.js';

/**
 * Sanctions screening of the supplier's legal name (lane H, plan section 6).
 *
 * Source: the OFAC Specially Designated Nationals (SDN) list, downloaded by `scripts/sanctions/refresh-ofac.ts`
 * and cached locally with its retrieval date and SHA-256. This module does no network I/O: it reads the cache.
 *
 * Outcomes, all fail-closed:
 *  - CLEAR: no entry matches. The check passes.
 *  - NEAR: a close token match. This includes common names (a supplier called "Mohammed Ali" matches many
 *    people). It is a HOLD for a person, never a REFUSE.
 *  - HIT: the normalised names are equal. Also a HOLD for a person.
 *  - UNAVAILABLE: no cache, an unreadable cache, or a cache older than the maximum age. A HOLD.
 *
 * The Warden never rejects on sanctions alone. A person decides (plan section 6).
 */

/** Longest age, in days, before a cached list counts as stale. The refresh script is run at least this often. */
export const SANCTIONS_MAX_AGE_DAYS = 30;

/** Minimum token overlap before a near match is reported. One shared word is never enough. */
const NEAR_MIN_TOKENS = 2;
const NEAR_THRESHOLD = 1; // overlap / smaller token count; 1 means every token of the shorter name appears.

const ENTRY = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  program: z.string(),
  type: z.string(),
});

export const SANCTIONS_SNAPSHOT = z.strictObject({
  source: z.literal('OFAC-SDN'),
  sourceUrl: z.string().url(),
  /** Calendar date (UTC) the file was downloaded. */
  retrievedAt: z.iso.date(),
  /** SHA-256 of the downloaded SDN.CSV bytes. */
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  entries: z.array(ENTRY),
});

export type SanctionsSnapshot = z.infer<typeof SANCTIONS_SNAPSHOT>;
export type SanctionsEntry = z.infer<typeof ENTRY>;

/** Words that carry no identity. Dropped before comparison (legal forms, articles and particles). */
const NOISE_TOKENS = new Set([
  'PTY', 'LTD', 'LIMITED', 'PROPRIETARY', 'INC', 'LLC', 'CO', 'CC', 'SA', 'PLC', 'CORP', 'COMPANY',
  'THE', 'OF', 'AND', 'AL', 'EL', 'DE', 'LA',
]);

/** Upper-case, strip accents and punctuation, split into tokens, drop noise. Pure and deterministic. */
export function nameTokens(name: string): string[] {
  const folded = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (folded === '') return [];
  return folded.split(' ').filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

export function normalisedName(name: string): string {
  return nameTokens(name).join(' ');
}

export type ScreenOutcome =
  | { readonly status: 'CLEAR' }
  | { readonly status: 'NEAR' | 'HIT'; readonly matches: readonly { id: string; name: string; program: string; kind: 'exact' | 'near' }[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: string };

/**
 * Screens one supplier name against a snapshot. `now` is injected so the staleness rule is testable.
 * Matches are sorted by id so the result is the same on every run (doctrine 5).
 */
export function screenSupplierName(
  supplierName: string,
  snapshot: SanctionsSnapshot | null,
  now: Date,
): ScreenOutcome {
  if (snapshot === null) return { status: 'UNAVAILABLE', reason: 'no sanctions list cached' };
  const ageDays = daysBetween(snapshot.retrievedAt, now);
  if (ageDays === null || ageDays < 0) {
    return { status: 'UNAVAILABLE', reason: 'sanctions list date is missing or in the future' };
  }
  if (ageDays > SANCTIONS_MAX_AGE_DAYS) {
    return { status: 'UNAVAILABLE', reason: `sanctions list is ${ageDays} days old (limit ${SANCTIONS_MAX_AGE_DAYS})` };
  }

  const subject = nameTokens(supplierName);
  if (subject.length === 0) return { status: 'UNAVAILABLE', reason: 'supplier name has no screenable words' };
  const subjectKey = subject.join(' ');
  const subjectSet = new Set(subject);

  const matches: { id: string; name: string; program: string; kind: 'exact' | 'near' }[] = [];
  for (const entry of snapshot.entries) {
    const tokens = nameTokens(entry.name);
    if (tokens.length === 0) continue;
    if (tokens.join(' ') === subjectKey) {
      matches.push({ id: entry.id, name: entry.name, program: entry.program, kind: 'exact' });
      continue;
    }
    const entrySet = new Set(tokens);
    const shared = [...subjectSet].filter((t) => entrySet.has(t)).length;
    const smaller = Math.min(subjectSet.size, entrySet.size);
    if (smaller >= NEAR_MIN_TOKENS && shared / smaller >= NEAR_THRESHOLD) {
      matches.push({ id: entry.id, name: entry.name, program: entry.program, kind: 'near' });
    }
  }
  if (matches.length === 0) return { status: 'CLEAR' };
  matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const status = matches.some((m) => m.kind === 'exact') ? 'HIT' : 'NEAR';
  return { status, matches };
}

/**
 * The Warden hook. Returns null when the name is clear, or a HOLD. It never returns REFUSE: a sanctions
 * match is a question for a person, and a source failure is a hold until the list is fresh again.
 */
export function sanctionsVerdict(outcome: ScreenOutcome): Verdict | null {
  switch (outcome.status) {
    case 'CLEAR':
      return null;
    case 'HIT':
      return hold(
        'SUPPLIER_NOT_APPROVED',
        `Supplier name matches a sanctions list entry exactly (${outcome.matches.map((m) => m.id).join(', ')}). A person must clear it.`,
      );
    case 'NEAR':
      return hold(
        'SUPPLIER_NOT_APPROVED',
        `Supplier name is a near match to a sanctions list entry (${outcome.matches.map((m) => m.id).join(', ')}). Common names match often; a person must clear it.`,
      );
    case 'UNAVAILABLE':
      return hold('SUPPLIER_NOT_APPROVED', `Sanctions screening could not run: ${outcome.reason}. Held until it can.`);
  }
}

/** Whole days from an ISO date (UTC midnight) to `now`. Negative when the date is in the future. */
export function daysBetween(isoDate: string, now: Date): number | null {
  const at = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return Math.floor((now.getTime() - at) / 86_400_000);
}
