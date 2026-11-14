import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDotEnv, parseDotEnv } from '../../src/env/dotenv.js';

/* Each test writes only inside its own temporary folder. */
/* eslint-disable security/detect-non-literal-fs-filename */

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dotenv-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('parseDotEnv', () => {
  it('reads KEY=VALUE lines, skips comments and blanks, and accepts an export prefix', () => {
    const text = ['# a comment', '', 'FIRST=one', 'export SECOND=two', '  THIRD = three  '].join(
      '\n',
    );
    expect([...parseDotEnv(text).entries()]).toEqual([
      ['FIRST', 'one'],
      ['SECOND', 'two'],
      ['THIRD', 'three'],
    ]);
  });

  it('removes one pair of matching quotes, and keeps a value that is only a quote', () => {
    const text = 'A="quoted value"\nB=\'single\'\nC="mismatched\'\nD="';
    const values = parseDotEnv(text);
    expect(values.get('A')).toBe('quoted value');
    expect(values.get('B')).toBe('single');
    expect(values.get('C')).toBe('"mismatched\'');
    expect(values.get('D')).toBe('"');
  });

  it('keeps an empty value so the caller can tell it from an absent one', () => {
    expect(parseDotEnv('EMPTY=').get('EMPTY')).toBe('');
  });

  it('names the line number, never the content, for a line that is not KEY=VALUE', () => {
    const text = 'OK=1\nsecret-looking-value-without-equals';
    expect(() => parseDotEnv(text)).toThrow('line 2 of the .env file is not KEY=VALUE');
    try {
      parseDotEnv(text);
    } catch (error) {
      expect(String(error)).not.toContain('secret-looking-value');
    }
  });

  it('refuses a name that is not an environment variable name', () => {
    expect(() => parseDotEnv('lower=1')).toThrow(
      'line 1 of the .env file names an invalid variable',
    );
    expect(() => parseDotEnv('1BAD=1')).toThrow(
      'line 1 of the .env file names an invalid variable',
    );
  });
});

describe('loadDotEnv', () => {
  it('sets the file variables that the environment does not hold, and leaves the others alone', () => {
    const path = join(directory, '.env');
    writeFileSync(path, 'ALPHA=from-file\nBETA=from-file\nGAMMA=\n');
    const environment: NodeJS.ProcessEnv = { BETA: 'from-shell' };
    const result = loadDotEnv(path, environment);
    expect(result).toEqual({ loaded: ['ALPHA'], kept: ['BETA'] });
    expect(environment['ALPHA']).toBe('from-file');
    expect(environment['BETA']).toBe('from-shell');
    expect(environment['GAMMA']).toBeUndefined();
  });

  it('does nothing when the file does not exist', () => {
    expect(loadDotEnv(join(directory, 'missing.env'), {})).toEqual({ loaded: [], kept: [] });
  });
});
