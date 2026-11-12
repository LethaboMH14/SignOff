import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { WARDEN_VERSION } from '../src/version.js';

describe('the Warden version', () => {
  it('matches the version in the package file, so the health answer tells the truth', () => {
    // The package file is this app's own, at a fixed place; nothing user-supplied is read.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the Warden's own package file, at a fixed path
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      readonly version: string;
    };
    expect(WARDEN_VERSION).toBe(pkg.version);
  });
});
