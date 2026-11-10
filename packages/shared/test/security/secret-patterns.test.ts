import { describe, expect, it } from 'vitest';

import { findSecrets, type SecretKind } from '../../src/security/secret-patterns.js';
import {
  corruptOneCharacter,
  ED25519_SEED_PREFIX,
  encodeFamilySeed,
  fixedEntropy,
  SECP256K1_SEED_PREFIX,
} from '../helpers/xrpl-fixtures.js';

/** Sample secrets are assembled from pieces, so this file never contains a complete one. */
const SAMPLE = {
  seed: encodeFamilySeed(SECP256K1_SEED_PREFIX, fixedEntropy(7)),
  edSeed: encodeFamilySeed(ED25519_SEED_PREFIX, fixedEntropy(8)),
  pemHeaderBeginEc: '-----BEGIN ' + 'EC PRIVATE KEY-----',
  pemHeaderEnd: '-----END ' + 'EC PRIVATE KEY-----',
  githubToken: 'ghp' + '_' + 'A1b2'.repeat(9),
  anthropicKey: 'sk-' + 'ant-' + 'a'.repeat(24),
  awsKey: 'AK' + 'IA' + 'Q'.repeat(16),
  xrplHexKey: 'ED' + 'a1'.repeat(32),
  bearer: 'abc123def456ghi789jkl',
  password: 'correct' + '-horse-9',
};

function kindsOf(text: string): SecretKind[] {
  return findSecrets(text).map((finding) => finding.kind);
}

describe('findSecrets: positive samples', () => {
  it('finds a checksum-valid XRPL seed in both forms', () => {
    expect(kindsOf(`token=${SAMPLE.seed}`)).toEqual(['xrpl-family-seed']);
    expect(kindsOf(`token=${SAMPLE.edSeed}`)).toEqual(['xrpl-family-seed']);
  });

  it('finds a PEM private key block from its first line to its last', () => {
    const block = [SAMPLE.pemHeaderBeginEc, 'MHcCAQEEIBqM3kz', SAMPLE.pemHeaderEnd].join('\n');
    expect(kindsOf(block)).toEqual(['pem-private-key']);
  });

  it('finds a GitHub personal access token', () => {
    expect(kindsOf(`GH=${SAMPLE.githubToken}`)).toEqual(['github-token']);
  });

  it('finds an Anthropic API key', () => {
    expect(kindsOf(`key: ${SAMPLE.anthropicKey}`)).toEqual(['anthropic-api-key']);
  });

  it('finds an AWS access key identifier', () => {
    expect(kindsOf(`id=${SAMPLE.awsKey}`)).toEqual(['aws-access-key-id']);
  });

  it('finds a hex private key that sits under a secret keyword', () => {
    expect(kindsOf(`{ "privateKey": "${SAMPLE.xrplHexKey}" }`)).toEqual(['xrpl-hex-private-key']);
  });

  it('finds a bearer token that contains a digit', () => {
    expect(kindsOf(`Authorization: Bearer ${SAMPLE.bearer}`)).toEqual(['bearer-token']);
  });

  it('finds a hard-coded password assignment', () => {
    expect(kindsOf(`password = "${SAMPLE.password}"`)).toEqual(['generic-credential']);
  });
});

describe('findSecrets: negative samples that must not be reported', () => {
  it('does not report a 64-character transaction hash or fingerprint', () => {
    const hash = 'ab12'.repeat(16);
    expect(kindsOf(`"hash": "${hash}"`)).toEqual([]);
    expect(kindsOf(`fingerprint = "${hash}"`)).toEqual([]);
  });

  it('does not report a hash under a key that merely starts with a secret word', () => {
    const hash = 'ab12'.repeat(16);
    expect(kindsOf(`seedHash = "${hash}"`)).toEqual([]);
  });

  it('does not report a public account address', () => {
    expect(kindsOf('Destination: rrrrrrrrrrrrrrrrrrrrrhoLvTp')).toEqual([]);
  });

  it('does not report a seed-shaped string with one wrong character', () => {
    const tampered = corruptOneCharacter(SAMPLE.seed, 12);
    expect(kindsOf(`token=${tampered}`)).toEqual([]);
  });

  it('does not report a placeholder that is read from the environment', () => {
    expect(kindsOf('password: "${PASSWORD}"')).toEqual([]);
    expect(kindsOf('password = process.env.DB_PASSWORD')).toEqual([]);
  });

  it('does not report ordinary prose that uses the security vocabulary', () => {
    const prose =
      'Keep the seed in a secret manager. Never paste a password into chat. ' +
      'Bearer tokens expire and tokens are rotated monthly.';
    expect(kindsOf(prose)).toEqual([]);
  });

  it('does not report invoice numbers and amounts', () => {
    expect(kindsOf('Invoice INV-2026-0001 total 12500.00 ZAR, due 2026-12-01')).toEqual([]);
  });

  it('does not report a GitHub-style prefix that is too short', () => {
    expect(kindsOf('ghp_short')).toEqual([]);
  });
});

describe('findSecrets: positions', () => {
  it('reports the 1-based line and column of the secret, never its value', () => {
    const text = ['first line', 'second line', `token=${SAMPLE.seed}`].join('\n');
    const [finding] = findSecrets(text);
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe('xrpl-family-seed');
    expect(finding?.line).toBe(3);
    expect(finding?.column).toBe('token='.length + 1);
    expect(JSON.stringify(finding)).not.toContain(SAMPLE.seed);
  });

  it('returns findings in position order', () => {
    const text = `${SAMPLE.githubToken} and ${SAMPLE.anthropicKey}`;
    expect(kindsOf(text)).toEqual(['github-token', 'anthropic-api-key']);
  });

  it('returns an empty list for empty text', () => {
    expect(findSecrets('')).toEqual([]);
  });
});
