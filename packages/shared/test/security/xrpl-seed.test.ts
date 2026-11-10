import { describe, expect, it } from 'vitest';

import { isXrplFamilySeed } from '../../src/security/xrpl-seed.js';
import {
  ACCOUNT_ZERO_ADDRESS,
  corruptOneCharacter,
  ED25519_SEED_PREFIX,
  encodeFamilySeed,
  fixedEntropy,
  SECP256K1_SEED_PREFIX,
} from '../helpers/xrpl-fixtures.js';

describe('isXrplFamilySeed: true positives', () => {
  it('accepts a checksum-valid secp256k1-form seed', () => {
    const seed = encodeFamilySeed(SECP256K1_SEED_PREFIX, fixedEntropy(1));
    expect(seed.startsWith('s')).toBe(true);
    expect(seed.length).toBeGreaterThanOrEqual(28);
    expect(seed.length).toBeLessThanOrEqual(34);
    expect(isXrplFamilySeed(seed)).toBe(true);
  });

  it('accepts a checksum-valid ed25519-form seed', () => {
    const seed = encodeFamilySeed(ED25519_SEED_PREFIX, fixedEntropy(2));
    expect(isXrplFamilySeed(seed)).toBe(true);
  });

  it('accepts a seed whose prefix is not one this module lists, because the checksum decides', () => {
    const unknownPrefix = Uint8Array.of(0x99, 0x42, 0x07);
    const seed = encodeFamilySeed(unknownPrefix, fixedEntropy(3));
    expect(isXrplFamilySeed(seed)).toBe(true);
  });
});

describe('isXrplFamilySeed: false positives it must avoid', () => {
  it('rejects a seed with one character changed, because the checksum no longer verifies', () => {
    const seed = encodeFamilySeed(SECP256K1_SEED_PREFIX, fixedEntropy(4));
    const tampered = corruptOneCharacter(seed, 10);
    expect(tampered).not.toBe(seed);
    expect(isXrplFamilySeed(tampered)).toBe(false);
  });

  it('rejects base58 text of the wrong decoded size even when it starts with s', () => {
    const wrongSize = encodeFamilySeed(Uint8Array.of(0x21, 0x00), fixedEntropy(5));
    expect(isXrplFamilySeed(wrongSize)).toBe(false);
  });

  it('rejects a public account address, which starts with r', () => {
    expect(isXrplFamilySeed(ACCOUNT_ZERO_ADDRESS)).toBe(false);
  });

  it('rejects text that is not base58 at all', () => {
    expect(isXrplFamilySeed('s0OIl0OIl0OIl0OIl0OIl0OIl0OIl')).toBe(false);
    expect(isXrplFamilySeed('s with spaces in it that is not a seed')).toBe(false);
  });

  it('rejects an empty string and a bare s', () => {
    expect(isXrplFamilySeed('')).toBe(false);
    expect(isXrplFamilySeed('s')).toBe(false);
  });
});
