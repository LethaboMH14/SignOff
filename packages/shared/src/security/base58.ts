/**
 * Base58 with the Ripple alphabet, the encoding the XRP Ledger uses for account addresses and
 * family seeds. Pure functions: no I/O and no shared state.
 */

/** Ripple's alphabet: the same 58 characters as Bitcoin's, in a different order. */
export const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

/** The alphabet's zero digit. Each leading zero byte is written as one leading 'r'. */
const ZERO_DIGIT = 'r';
const BASE = 58n;

const DIGIT_VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(RIPPLE_ALPHABET, (character, index) => [character, index] as const),
);

if (RIPPLE_ALPHABET.length !== 58 || DIGIT_VALUES.size !== 58) {
  throw new Error('The Ripple base58 alphabet must contain 58 distinct characters.');
}

/** Encode bytes as base58. Leading zero bytes become leading 'r' characters. */
export function base58Encode(bytes: Uint8Array): string {
  let leadingZeroBytes = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeroBytes++;
  }

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let digits = '';
  while (value > 0n) {
    digits = RIPPLE_ALPHABET.charAt(Number(value % BASE)) + digits;
    value /= BASE;
  }
  return ZERO_DIGIT.repeat(leadingZeroBytes) + digits;
}

/**
 * Decode base58 text into bytes. Returns undefined for empty text or for any character outside
 * the alphabet, so callers can treat "not base58" as a plain negative answer.
 */
export function base58Decode(text: string): Uint8Array | undefined {
  if (text.length === 0) return undefined;

  let value = 0n;
  let leadingZeroBytes = 0;
  let inLeadingRun = true;
  for (const character of text) {
    const digit = DIGIT_VALUES.get(character);
    if (digit === undefined) return undefined;
    if (inLeadingRun && character === ZERO_DIGIT) {
      leadingZeroBytes++;
    } else {
      inLeadingRun = false;
    }
    value = value * BASE + BigInt(digit);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  bytes.reverse();

  const decoded = new Uint8Array(leadingZeroBytes + bytes.length);
  decoded.set(bytes, leadingZeroBytes);
  return decoded;
}
