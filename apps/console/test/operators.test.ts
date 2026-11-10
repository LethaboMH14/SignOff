/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadOperators, type OperatorInput, upsertOperator } from '../src/server/auth/operators.js';

const HASH = 'scrypt$placeholder';
const SECRET = randomBytes(32).toString('base64');

function operatorOf(username: string): OperatorInput {
  return {
    username,
    role: 'operator',
    passwordHash: HASH,
    wardenPrincipal: `operator-${username}`,
    wardenSecret: SECRET,
  };
}

const VIEWER: OperatorInput = {
  username: 'vera',
  role: 'viewer',
  passwordHash: HASH,
  wardenPrincipal: null,
  wardenSecret: null,
};

describe('adding and replacing operators', () => {
  it('adds a new person, and replaces a person who is already there', () => {
    const first = upsertOperator([operatorOf('alice')], operatorOf('bongani'));
    expect(first.map((record) => record.username).sort()).toEqual(['alice', 'bongani']);
    const replaced = upsertOperator(first, {
      ...operatorOf('alice'),
      passwordHash: 'scrypt$other',
    });
    expect(replaced.map((record) => record.username).sort()).toEqual(['alice', 'bongani']);
    expect(replaced.find((record) => record.username === 'alice')?.passwordHash).toBe(
      'scrypt$other',
    );
  });

  it('refuses a name that is not in the lower-case form the file requires', () => {
    expect(() => upsertOperator([], { ...operatorOf('alice'), username: 'Alice' })).toThrow();
  });

  it('refuses a change that would not load, and leaves the records as they were', () => {
    const records = [operatorOf('alice')];
    expect(() =>
      upsertOperator(records, { ...VIEWER, wardenPrincipal: 'operator-vera' }),
    ).toThrow();
    expect(records).toHaveLength(1);
  });
});

describe('loading the operator file', () => {
  let directory = '';
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'console-operators-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads the operators the file names', () => {
    const path = join(directory, 'operators.json');
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, operators: [operatorOf('alice'), VIEWER] }),
    );
    const store = loadOperators(path);
    expect(store.size).toBe(2);
    expect(store.find('vera')?.role).toBe('viewer');
  });

  it('refuses a file with a version it does not know', () => {
    const path = join(directory, 'operators.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 2, operators: [] }));
    expect(() => loadOperators(path)).toThrow();
  });
});
