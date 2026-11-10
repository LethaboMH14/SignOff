import { describe, expect, it } from 'vitest';

import { redactText, redactValue } from '../../src/logging/redact.js';
import { encodeFamilySeed, fixedEntropy, SECP256K1_SEED_PREFIX } from '../helpers/xrpl-fixtures.js';

/** Sample secrets are assembled from pieces, so this file never holds a complete one. */
const SEED = encodeFamilySeed(SECP256K1_SEED_PREFIX, fixedEntropy(21));
const PEM_BEGIN = '-----BEGIN ' + 'EC PRIVATE KEY-----';
const PEM_END = '-----END ' + 'EC PRIVATE KEY-----';
const PEM_BODY = 'MHcCAQEEIBqM3kzExampleBodyLine';
const GITHUB_TOKEN = 'ghp' + '_' + 'A1b2'.repeat(9);
const HASH = 'ab12'.repeat(16);
const OBLIGATION_KEY = '487b60acfaaefee676b8760d6d8b1ea03725e70a01b227702967f89df5ecbaea';

describe('redactText', () => {
  it('removes a seed, a private-key block with its body, a token and a password', () => {
    const text = [
      `seed ${SEED}`,
      PEM_BEGIN,
      PEM_BODY,
      PEM_END,
      `token ${GITHUB_TOKEN}`,
      'password = "correct' + '-horse-9"',
    ].join('\n');

    const redacted = redactText(text);

    expect(redacted).not.toContain(SEED);
    expect(redacted).not.toContain(PEM_BODY);
    expect(redacted).not.toContain(GITHUB_TOKEN);
    expect(redacted).not.toContain('correct-horse-9');
    expect(redacted).toContain('[REDACTED:xrpl-family-seed]');
    expect(redacted).toContain('[REDACTED:pem-private-key]');
    expect(redacted).toContain('[REDACTED:github-token]');
    expect(redacted).toContain('[REDACTED:generic-credential]');
  });

  it('removes an unterminated private-key block to the end of the text', () => {
    const redacted = redactText(`before ${PEM_BEGIN}\n${PEM_BODY}`);
    expect(redacted).not.toContain(PEM_BODY);
    expect(redacted).toContain('[REDACTED:pem-private-key]');
  });

  it('removes personal and financial identifiers from free text', () => {
    const redacted = redactText('pay jane.doe@example.com via GB82WEST12345698765432');
    expect(redacted).not.toContain('jane.doe@example.com');
    expect(redacted).not.toContain('GB82WEST12345698765432');
    expect(redacted).toContain('[REDACTED:email]');
    expect(redacted).toContain('[REDACTED:iban]');
  });

  it('keeps transaction hashes, obligation keys, amounts and invoice numbers readable', () => {
    const text = `tx ${HASH} obligation ${OBLIGATION_KEY} total 12,500.50 ZAR invoice INV-2026-0001`;
    expect(redactText(text)).toBe(text);
  });

  it('returns text with nothing sensitive unchanged', () => {
    expect(redactText('payment held: amount 1,250.00 USD')).toBe(
      'payment held: amount 1,250.00 USD',
    );
  });
});

describe('redactValue: structure', () => {
  it('replaces sensitive fields whatever their value, whatever the case or punctuation', () => {
    const redacted = redactValue({
      seed: SEED,
      Bank_Account: '0123456789',
      payeeAccountAsPrinted: 'Account 0123456789',
      email: 'jane.doe@example.com',
      password: 'short',
      authorization: 'anything at all',
      supplierId: 'SUP-ABC123',
      amountMinor: 1250050,
    });

    expect(redacted).toEqual({
      seed: '[REDACTED:field]',
      Bank_Account: '[REDACTED:field]',
      payeeAccountAsPrinted: '[REDACTED:field]',
      email: '[REDACTED:field]',
      password: '[REDACTED:field]',
      authorization: '[REDACTED:field]',
      supplierId: 'SUP-ABC123',
      amountMinor: 1250050,
    });
  });

  it('redacts secrets or personal identifiers used as untrusted property names', () => {
    const object: Record<string, unknown> = {
      [`vendor-jane.doe@example.com`]: 'reviewed',
      [`payment-${SEED}`]: 'pending',
      reference: 'safe',
    };
    const redacted = redactValue(object) as Record<string, unknown>;
    const output = JSON.stringify(redacted);
    expect(output).not.toContain('jane.doe@example.com');
    expect(output).not.toContain(SEED);
    expect(output).toContain('[REDACTED:email]');
    expect(output).toContain('[REDACTED:xrpl-family-seed]');
    expect(redacted['reference']).toBe('safe');
  });

  it('walks nested objects and arrays, and redacts text inside string values', () => {
    const redacted = redactValue({
      event: { note: `signed with ${SEED}`, items: [{ token: 'x' }, { status: 'ok' }] },
    });
    expect(JSON.stringify(redacted)).not.toContain(SEED);
    expect(redacted).toEqual({
      event: {
        note: 'signed with [REDACTED:xrpl-family-seed]',
        items: [{ token: '[REDACTED:field]' }, { status: 'ok' }],
      },
    });
  });

  it('does not modify its input', () => {
    const input = { seed: SEED, nested: { email: 'a@example.com' } };
    const snapshot = JSON.stringify(input);
    redactValue(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('cuts cycles instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    expect(redactValue(cyclic)).toEqual({ name: 'loop', self: '[Circular]' });
  });

  it('limits depth, width and string length', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
    expect(JSON.stringify(redactValue(deep))).toContain('[Truncated]');

    const wide = Array.from({ length: 60 }, (_, index) => index);
    const widened = redactValue(wide) as unknown[];
    expect(widened).toHaveLength(51);
    expect(widened.at(-1)).toBe('[10 more]');

    const long = redactValue('x'.repeat(2500)) as string;
    expect(long.endsWith('[TRUNCATED]')).toBe(true);
    expect(long.length).toBeLessThan(2100);
  });

  it('converts values JSON cannot carry, without throwing', () => {
    expect(redactValue(10n ** 20n)).toBe('100000000000000000000');
    expect(redactValue(Number.NaN)).toBe('NaN');
    expect(redactValue(Symbol('x'))).toBe('[Symbol]');
    expect(redactValue(() => 1)).toBe('[Function]');
    expect(redactValue(new Map([['a', 1]]))).toBe('[Map size=1]');
    expect(redactValue(new Set([1, 2]))).toBe('[Set size=2]');
    expect(redactValue(new Date('2026-11-10T10:00:00Z'))).toBe('2026-11-10T10:00:00.000Z');
    expect(redactValue(new Date('not a date'))).toBe('Invalid Date');
  });

  it('redacts secrets inside an error message and stack', () => {
    const error = new Error(`failed with ${SEED}`);
    const redacted = redactValue({ error }) as {
      error: { name: string; message: string; stack: string };
    };
    expect(redacted.error.message).toBe('failed with [REDACTED:xrpl-family-seed]');
    expect(redacted.error.stack).not.toContain(SEED);
    expect(redacted.error.name).toBe('Error');
  });

  it('marks a field whose getter throws instead of failing the whole record', () => {
    const hostile = {
      ok: 'fine',
      get broken(): string {
        throw new Error('boom');
      },
    };
    expect(redactValue(hostile)).toEqual({ ok: 'fine', broken: '[Unreadable]' });
  });

  it('keeps an attacker-chosen key named __proto__ as ordinary data', () => {
    const payload = JSON.parse('{"__proto__": {"injected": true}}') as Record<string, unknown>;
    const redacted = redactValue(payload) as Record<string, unknown>;
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(redacted, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>)['injected']).toBeUndefined();
  });
});
