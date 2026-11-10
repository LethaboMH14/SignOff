import { isXrplFamilySeed } from './xrpl-seed.js';

/** The kinds of secret this package recognises. Only the kind is ever reported, never the value. */
export type SecretKind =
  | 'xrpl-family-seed'
  | 'xrpl-hex-private-key'
  | 'pem-private-key'
  | 'github-token'
  | 'anthropic-api-key'
  | 'aws-access-key-id'
  | 'bearer-token'
  | 'generic-credential';

export interface SecretFinding {
  readonly kind: SecretKind;
  /** 1-based line of the first character of the secret. */
  readonly line: number;
  /** 1-based column of the first character of the secret. */
  readonly column: number;
  /** Offsets of the secret within the scanned text, for redaction. The value is not included. */
  readonly start: number;
  readonly end: number;
}

interface PatternRule {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
}

/**
 * Patterns with a fixed shape. Each has a positive and a negative test in the test suite.
 * The XRPL hex rule needs a keyword in front of the key, so ordinary 64-character hashes
 * (transaction hashes, document fingerprints) are never flagged.
 */
const PATTERN_RULES: readonly PatternRule[] = [
  {
    kind: 'pem-private-key',
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  {
    kind: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  {
    kind: 'anthropic-api-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    kind: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    kind: 'xrpl-hex-private-key',
    pattern:
      /\b(?:private[_-]?key|secret|seed|signing[_-]?key)["']?\s*[:=]\s*["']?(?:ED|00)[0-9A-Fa-f]{64}\b/gi,
  },
  {
    kind: 'bearer-token',
    pattern: /\bBearer\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,}/g,
  },
  {
    kind: 'generic-credential',
    pattern:
      /\b(?:password|passwd|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']([A-Za-z0-9!@#%^&*_+=./-]{12,})["']/gi,
  },
];

/**
 * A run of 28 to 34 base58 characters, bounded by non-alphanumerics. This covers the decoded
 * sizes of XRPL family seeds. Every candidate is then checked for a valid checksum, so the broad
 * character class cannot produce false positives in practice. Bounding the run keeps long hashes,
 * which are also base58-shaped, out of the candidate set.
 */
const SEED_CANDIDATE = /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{27,33}(?![A-Za-z0-9])/g;

interface RawFinding {
  readonly kind: SecretKind;
  readonly start: number;
  readonly end: number;
}

/** Find every secret in a text. Results are sorted by position. Values are never returned. */
export function findSecrets(text: string): readonly SecretFinding[] {
  const found: RawFinding[] = [];

  for (const rule of PATTERN_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      found.push({ kind: rule.kind, start: match.index, end: match.index + match[0].length });
    }
  }

  for (const match of text.matchAll(SEED_CANDIDATE)) {
    if (isXrplFamilySeed(match[0])) {
      found.push({
        kind: 'xrpl-family-seed',
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  found.sort((a, b) => a.start - b.start || a.end - b.end);

  return withPositions(text, found);
}

/**
 * Attach a line and column to each item, given in ascending order of start. One pass over the
 * text keeps the work proportional to its length, and no array is looked up by a variable index.
 */
function withPositions(text: string, items: readonly RawFinding[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  let line = 1;
  let lineStart = 0;
  let cursor = 0;
  for (const item of items) {
    while (cursor < item.start) {
      if (text.charCodeAt(cursor) === 10) {
        line++;
        lineStart = cursor + 1;
      }
      cursor++;
    }
    findings.push({
      kind: item.kind,
      line,
      column: item.start - lineStart + 1,
      start: item.start,
      end: item.end,
    });
  }
  return findings;
}
