import { describe, expect, it } from 'vitest';

import { WardenReasonCode } from '../../../packages/shared/src/schemas/warden-decision.js';
import { catalogueCodes, reasonTextOf } from '../src/model/reasons.js';

describe('the plain-language reason catalogue', () => {
  it('has plain text for every reason code the Warden can give', () => {
    const codes = catalogueCodes();
    for (const code of WardenReasonCode.options) {
      expect(codes).toContain(code);
      expect(reasonTextOf(code)).not.toMatch(/^Reason code /);
    }
  });

  it('gives every entry a full sentence, and never an empty one', () => {
    for (const code of catalogueCodes()) {
      const text = reasonTextOf(code);
      expect(text.length).toBeGreaterThan(10);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('shows an unknown code as its code, with no invented sentence', () => {
    expect(reasonTextOf('SOMETHING_NEW')).toBe('Reason code SOMETHING_NEW: no plain text yet.');
  });
});
