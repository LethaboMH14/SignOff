import { findSecrets, type SecretKind } from '../security/secret-patterns.js';

import { findPii, type PiiKind } from './pii.js';

/**
 * Redaction for everything that is written to a log. Two layers, both applied:
 *
 * 1. Text: secrets and personal identifiers inside any string are replaced by a marker that names
 *    the kind. Whole PEM key blocks are removed, body included.
 * 2. Structure: any field whose name suggests a secret or personal data is replaced, whatever its
 *    value. Depth, width and length are capped, and cycles are cut, so a hostile or huge object
 *    cannot blow up the log or hide a value in an unexpected corner.
 *
 * Over-redaction is the accepted failure mode. A hidden harmless value costs nothing; a leaked
 * secret costs the system.
 */

export type RedactionKind = SecretKind | PiiKind | 'field';

export interface RedactionLimits {
  readonly maxDepth: number;
  readonly maxItems: number;
  readonly maxString: number;
}

export const DEFAULT_REDACTION_LIMITS: RedactionLimits = {
  maxDepth: 6,
  maxItems: 50,
  maxString: 2000,
};

/** Fragments of field names that mark a value as sensitive. Matching ignores case and punctuation. */
const SENSITIVE_FIELD_PARTS: readonly string[] = [
  'seed',
  'secret',
  'privatekey',
  'signingkey',
  'password',
  'passwd',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'iban',
  'swift',
  'routing',
  'bank',
  'account',
  'beneficiary',
  'nationalid',
  'idnumber',
  'passport',
  'email',
  'phone',
  'mobile',
  'msisdn',
  'address',
];

export function isSensitiveField(name: string): boolean {
  const normalised = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_FIELD_PARTS.some((part) => normalised.includes(part));
}

interface Span {
  readonly kind: RedactionKind;
  readonly start: number;
  readonly end: number;
}

/** Replace every secret and personal identifier in a string with a marker naming its kind. */
export function redactText(text: string): string {
  const spans: Span[] = [
    ...findSecrets(text).map((finding) => ({
      kind: finding.kind,
      start: finding.start,
      end: finding.end,
    })),
    ...findPii(text),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  let output = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.end <= cursor) continue;
    const start = Math.max(span.start, cursor);
    output += text.slice(cursor, start) + `[REDACTED:${span.kind}]`;
    cursor = span.end;
  }
  return output + text.slice(cursor);
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}[TRUNCATED]`;
}

/**
 * A JSON-safe copy of a value with every sensitive field and every sensitive string removed. The input
 * is never modified. Getters that throw, cycles, very deep structures and very wide ones are all
 * handled without throwing.
 */
export function redactValue(
  value: unknown,
  limits: RedactionLimits = DEFAULT_REDACTION_LIMITS,
): unknown {
  return walk(value, 0, new WeakSet<object>(), limits);
}

function walk(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  limits: RedactionLimits,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(redactText(value), limits.maxString);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return '[Symbol]';
  if (typeof value === 'function') return '[Function]';
  if (depth >= limits.maxDepth) return '[Truncated]';

  if (value instanceof Error) {
    return {
      name: truncate(redactText(value.name), limits.maxString),
      message: truncate(redactText(value.message), limits.maxString),
      stack:
        value.stack === undefined ? undefined : truncate(redactText(value.stack), limits.maxString),
    };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof Map || value instanceof Set) {
    return `[${value instanceof Map ? 'Map' : 'Set'} size=${String(value.size)}]`;
  }

  if (typeof value !== 'object') return '[Unsupported]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value.slice(0, limits.maxItems)) {
      items.push(walk(item, depth + 1, seen, limits));
    }
    if (value.length > limits.maxItems) {
      items.push(`[${String(value.length - limits.maxItems)} more]`);
    }
    seen.delete(value);
    return items;
  }

  // Entries are collected first and built with Object.fromEntries, which defines every key as an
  // own data property. A key such as "__proto__" therefore cannot change the prototype of the result.
  const entries: [string, unknown][] = [];
  const keys = Object.keys(value);
  for (const key of keys.slice(0, limits.maxItems)) {
    if (isSensitiveField(key)) {
      entries.push([key, '[REDACTED:field]']);
      continue;
    }
    try {
      entries.push([key, walk(Reflect.get(value, key), depth + 1, seen, limits)]);
    } catch {
      entries.push([key, '[Unreadable]']);
    }
  }
  if (keys.length > limits.maxItems) {
    entries.push(['[more]', `${String(keys.length - limits.maxItems)} more fields`]);
  }
  seen.delete(value);
  return Object.fromEntries(entries);
}
