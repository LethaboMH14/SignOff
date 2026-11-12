import { describe, expect, it } from 'vitest';

import { devFieldsAllowed, withDevFields } from '../src/dev-fields.js';

describe('dev-only field gate', () => {
  it('is closed by default', () => {
    expect(devFieldsAllowed({})).toBe(false);
  });

  it('opens only when the flag is exactly 1 and the environment is not production', () => {
    expect(devFieldsAllowed({ SIGNOFF_DEV_FIELDS: '1' })).toBe(true);
    expect(devFieldsAllowed({ SIGNOFF_DEV_FIELDS: 'true' })).toBe(false);
    expect(devFieldsAllowed({ SIGNOFF_DEV_FIELDS: '1', NODE_ENV: 'production' })).toBe(false);
  });

  it('adds the dev fields only when allowed, and never mutates the base object', () => {
    const base = { ok: true };
    expect(withDevFields(base, { trace: 'x' }, false)).toEqual({ ok: true });
    expect(withDevFields(base, { trace: 'x' }, true)).toEqual({ ok: true, trace: 'x' });
    expect(base).toEqual({ ok: true });
  });
});
