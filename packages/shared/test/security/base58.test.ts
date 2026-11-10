import { describe, expect, it } from 'vitest';

import { base58Decode, base58Encode, RIPPLE_ALPHABET } from '../../src/security/base58.js';
import { doubleSha256 } from '../../src/security/checksum.js';
import { ACCOUNT_ZERO_ADDRESS, fixedEntropy } from '../helpers/xrpl-fixtures.js';

describe('Ripple base58 alphabet', () => {
  it('has 58 distinct characters and leaves out the look-alikes 0, O, I and l', () => {
    expect(RIPPLE_ALPHABET).toHaveLength(58);
    expect(new Set(RIPPLE_ALPHABET).size).toBe(58);
    for (const excluded of ['0', 'O', 'I', 'l']) {
      expect(RIPPLE_ALPHABET.includes(excluded), excluded).toBe(false);
    }
  });
});

describe('base58Decode', () => {
  it('decodes the account-zero address to 25 bytes whose checksum verifies', () => {
    const decoded = base58Decode(ACCOUNT_ZERO_ADDRESS);
    expect(decoded).toBeDefined();
    if (decoded === undefined) return;

    expect(decoded).toHaveLength(25);
    // Version byte plus 20 account bytes are all zero: 21 leading zero bytes.
    expect(Array.from(decoded.subarray(0, 21)).every((byte) => byte === 0)).toBe(true);

    const payload = decoded.subarray(0, 21);
    const claimed = decoded.subarray(21);
    expect(Array.from(doubleSha256(payload).subarray(0, 4))).toEqual(Array.from(claimed));
  });

  it('maps each leading r to one leading zero byte', () => {
    expect(base58Decode('r')).toEqual(Uint8Array.of(0));
    expect(base58Decode('rr')).toEqual(Uint8Array.of(0, 0));
  });

  it('rejects empty text', () => {
    expect(base58Decode('')).toBeUndefined();
  });

  it('rejects any character outside the alphabet', () => {
    for (const bad of ['0', 'O', 'I', 'l', '+', '/', ' ', 'é', 'sno0']) {
      expect(base58Decode(bad), bad).toBeUndefined();
    }
  });
});

describe('base58Encode', () => {
  it('writes leading zero bytes as leading r characters', () => {
    expect(base58Encode(Uint8Array.of(0, 0))).toBe('rr');
    expect(base58Encode(Uint8Array.of(0, 1))).toBe('rp');
  });

  it('encodes empty input to empty text', () => {
    expect(base58Encode(new Uint8Array())).toBe('');
  });

  it('round-trips through decode for a range of inputs', () => {
    const samples: Uint8Array[] = [
      Uint8Array.of(0),
      Uint8Array.of(0, 0, 1),
      Uint8Array.of(255),
      Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9),
      fixedEntropy(1),
      fixedEntropy(2),
      Uint8Array.from({ length: 64 }, (_, index) => (index * 97) & 0xff),
    ];
    for (const sample of samples) {
      const roundTripped = base58Decode(base58Encode(sample));
      expect(roundTripped).toEqual(sample);
    }
  });
});
