/**
 * Masking and secret refusal, applied to every item before it enters a context. A bank account number of eight or more
 * digits is shown as its last four digits. A text that looks like a credential is refused: the call is not made, so a
 * key can never reach a model through context, even if a record was filled with one by mistake.
 */

// eslint-disable-next-line security/detect-unsafe-regex -- the pattern repeats one digit per step, so matching is linear
const ACCOUNT_RUN = /(?<![A-Za-z0-9])(?:\d[ -]?){8,}\d(?![A-Za-z0-9])/g;

export function maskAccounts(text: string): string {
  return text.replace(ACCOUNT_RUN, (run) => {
    const digits = run.replace(/\D/g, '');
    return `****${digits.slice(-4)}`;
  });
}

/** Patterns that are never sent to a model. Each names the kind of secret, never the value. */
const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['provider key', /\b(OPENROUTER|GROQ|GEMINI|META)_API_KEY\b/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i],
  ['secret-key prefix', /\bsk-[A-Za-z0-9]{16,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['ledger seed', /\bs[1-9A-HJ-NP-Za-km-z]{27,28}\b/],
];

export class SecretInContextError extends Error {
  constructor(kind: string) {
    super(`a context item contains a ${kind}; the call is refused`);
    this.name = 'SecretInContextError';
  }
}

export function assertNoSecrets(text: string): void {
  for (const [kind, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new SecretInContextError(kind);
    }
  }
}
