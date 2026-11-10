import { describe, expect, it } from 'vitest';

import { SHARED_PACKAGE_NAME } from '../src/index.js';

describe('@signoff/shared', () => {
  it('identifies itself with the package name every service imports', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@signoff/shared');
  });
});
