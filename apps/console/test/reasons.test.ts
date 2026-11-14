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

  it('has plain text for every reason code the agent writes, so no placeholder reaches the desk', () => {
    const agentCodes = [
      'OK',
      'ALREADY_HANDLED',
      'SCREEN_FLAGGED',
      'SCREEN_HOLD',
      'VERIFICATION_FAILED',
      'MATCH_FAILED',
      'INTERNAL_STATE',
      'CURRENCY_NOT_PAYABLE',
      'FX_UNAVAILABLE',
      'PROPOSAL_INVALID',
      'WARDEN_REFUSED_REQUEST',
      'PROPOSE_OUTCOME_UNKNOWN',
      'ATTEMPT_ID_MISMATCH',
      'WARDEN_NO_TRANSACTION',
      'SIGNING_FAILED',
      'SENT',
      'WARDEN_REFUSED_COSIGN',
      'OUTCOME_UNKNOWN',
      'RESULT_MISMATCH',
      'RESULT_UNREADABLE',
      'PAID',
      'MATCHED',
      'WARDEN_HELD_AT_SUBMISSION',
      'OUTCOME_PENDING',
      'WARDEN_HOLD',
    ];
    for (const code of agentCodes) {
      expect(reasonTextOf(code), code).not.toMatch(/^Reason code /);
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
