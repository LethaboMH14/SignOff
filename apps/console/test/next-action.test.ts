import { describe, expect, it } from 'vitest';

import { WardenReasonCode } from '../../../packages/shared/src/schemas/warden-decision.js';
import { catalogueCodes } from '../src/model/reasons.js';
import { maskAccount, nextActionCodes, nextActionOf } from '../src/model/next-action.js';

describe('the next steps', () => {
  it('has a written next step for every reason code that can hold or refuse an invoice', () => {
    const written = nextActionCodes();
    for (const code of catalogueCodes().filter((candidate) => candidate !== 'OK')) {
      expect(written, code).toContain(code);
    }
    for (const code of WardenReasonCode.options) {
      expect(written, code).toContain(code);
    }
  });

  it('states plainly when no step is written, rather than inventing one', () => {
    expect(nextActionOf('NOT_A_CODE')).toBe(
      'No next step is written for code NOT_A_CODE yet. Ask an operator to review it.',
    );
  });
});

describe('masking an account', () => {
  it('shows only the last four characters', () => {
    expect(maskAccount('rExampleAccountWXYZ')).toBe('…WXYZ');
  });

  it('hides a short value entirely, and passes nothing through as a value', () => {
    expect(maskAccount('abc')).toBe('…');
    expect(maskAccount(null)).toBeNull();
  });
});
