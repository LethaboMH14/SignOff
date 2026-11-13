import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { WardenReasonCode } from '../../../packages/shared/src/schemas/warden-decision.js';
import { ACTORS } from '../../agent/src/log/transition-log.js';
import { STATES } from '../../agent/src/workflow/states.js';
import {
  ACTOR_LABELS,
  AGENT_ACTORS,
  AGENT_STATES,
  nodeOf,
  OWNER_WAIT_REASON,
  type MapEventInput,
  parseMapEvent,
  reasonTextOf,
  STATE_LABELS,
  toMovement,
  toneOf,
} from '../src/model/states.js';

const HASH = 'a'.repeat(64);

function eventOf(overrides: Partial<MapEventInput>): MapEventInput {
  return {
    seq: 1,
    at: '2026-11-10T10:00:00.000Z',
    correlationId: HASH,
    fromState: null,
    toState: 'RECEIVED',
    actor: 'intake',
    reasonCode: 'OK',
    policyVersion: '2026-11-10.1',
    ...overrides,
  };
}

describe('the lists the browser uses match the agent', () => {
  it('has the same states, in the same order, as the agent', () => {
    expect([...AGENT_STATES]).toEqual([...STATES]);
  });

  it('has the same actors, in the same order, as the agent', () => {
    expect([...AGENT_ACTORS]).toEqual([...ACTORS]);
  });

  it('has a label for every state and every actor', () => {
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...AGENT_STATES].sort());
    expect(Object.keys(ACTOR_LABELS).sort()).toEqual([...AGENT_ACTORS].sort());
    for (const label of [...Object.values(STATE_LABELS), ...Object.values(ACTOR_LABELS)]) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('has plain text for every Warden reason code, so none is shown as a bare code', () => {
    for (const code of WardenReasonCode.options) {
      expect(reasonTextOf(code)).not.toContain('no plain text yet');
    }
  });
});

describe('plain text for reasons', () => {
  it('shows the fixed text for a known code, and the code itself for an unknown one', () => {
    expect(reasonTextOf('PAYEE_CHANGED')).toBe(
      'The account on the invoice is not the account this supplier enrolled.',
    );
    expect(reasonTextOf('SOMETHING_NEW')).toBe('Reason code SOMETHING_NEW: no plain text yet.');
  });
});

describe('where a move goes on the map', () => {
  it('sends a progress move to the agent that made it', () => {
    const movement = toMovement(eventOf({ toState: 'RECEIVED', actor: 'intake' }));
    expect(movement.node).toBe('intake');
    expect(movement.tone).toBe('progress');
    expect(movement.label).toBe(STATE_LABELS.RECEIVED);
  });

  it('sends a quarantined or held move to the hold lane, with a hold tone', () => {
    expect(toMovement(eventOf({ toState: 'QUARANTINED', actor: 'screen' }))).toMatchObject({
      node: 'hold',
      tone: 'hold',
    });
    expect(toMovement(eventOf({ toState: 'HELD', actor: 'matcher' }))).toMatchObject({
      node: 'hold',
      tone: 'hold',
    });
  });

  it('sends a ledger move to the ledger, as submitted and not yet paid', () => {
    expect(toMovement(eventOf({ toState: 'SUBMITTED', actor: 'submitter' }))).toMatchObject({
      node: 'ledger',
      tone: 'submitted',
    });
    expect(toMovement(eventOf({ toState: 'VALIDATED', actor: 'reconciler' }))).toMatchObject({
      node: 'ledger',
      tone: 'submitted',
    });
  });

  it('marks a failed ledger move as failed, and a reconciliation exception on the hold lane', () => {
    expect(toMovement(eventOf({ toState: 'FAILED', actor: 'submitter' }))).toMatchObject({
      node: 'ledger',
      tone: 'failed',
    });
    expect(
      toMovement(eventOf({ toState: 'RECONCILIATION_EXCEPTION', actor: 'reconciler' })),
    ).toMatchObject({ node: 'hold', tone: 'failed' });
  });

  it('shows only a reconciled move as paid', () => {
    for (const state of AGENT_STATES) {
      if (state === 'RECONCILED') {
        expect(toneOf(state)).toBe('paid');
      } else {
        expect(toneOf(state)).not.toBe('paid');
      }
    }
    expect(toMovement(eventOf({ toState: 'RECONCILED', actor: 'reconciler' }))).toMatchObject({
      node: 'paid',
      tone: 'paid',
    });
  });

  it('names the invoice by the first eight characters of its correlation id', () => {
    expect(
      toMovement(eventOf({ correlationId: `${'b'.repeat(8)}${'c'.repeat(56)}` })).invoice,
    ).toBe('bbbbbbbb');
  });

  it('keeps the acting agent as the place for every state that is not a hold, ledger or paid move', () => {
    for (const state of AGENT_STATES) {
      if (
        [
          'HELD',
          'QUARANTINED',
          'RECONCILIATION_EXCEPTION',
          'SUBMITTED',
          'VALIDATED',
          'FAILED',
          'RECONCILED',
        ].includes(state)
      ) {
        continue;
      }
      expect(nodeOf(state, 'signer')).toBe('signer');
    }
  });
});

describe('parseMapEvent', () => {
  const valid = {
    seq: 4,
    at: '2026-11-10T10:00:00.000Z',
    correlationId: HASH,
    fromState: 'RECEIVED',
    toState: 'EXTRACTED',
    actor: 'extractor',
    reasonCode: 'OK',
    policyVersion: '2026-11-10.1',
  };

  it('accepts a well-formed move', () => {
    expect(parseMapEvent(valid)).toEqual(valid);
  });

  it('accepts a first move with no earlier state', () => {
    expect(parseMapEvent({ ...valid, fromState: null })).not.toBeNull();
  });

  it('refuses anything malformed, so it is never shown', () => {
    expect(parseMapEvent(null)).toBeNull();
    expect(parseMapEvent('text')).toBeNull();
    expect(parseMapEvent({ ...valid, seq: 0 })).toBeNull();
    expect(parseMapEvent({ ...valid, seq: 1.5 })).toBeNull();
    expect(parseMapEvent({ ...valid, at: 'yesterday' })).toBeNull();
    expect(parseMapEvent({ ...valid, correlationId: 'not-a-hash' })).toBeNull();
    expect(parseMapEvent({ ...valid, fromState: 'SOMEWHERE' })).toBeNull();
    expect(parseMapEvent({ ...valid, toState: 'SOMEWHERE' })).toBeNull();
    expect(parseMapEvent({ ...valid, actor: 'robot' })).toBeNull();
    expect(parseMapEvent({ ...valid, reasonCode: 'lower case' })).toBeNull();
    expect(parseMapEvent({ ...valid, reasonCode: 'A'.repeat(65) })).toBeNull();
    expect(parseMapEvent({ ...valid, policyVersion: 3 })).toBeNull();
  });
});

describe('the replay of the labelled set', () => {
  it('uses only reason codes that have plain text, so the feed never shows a bare code for them', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the fixture path is fixed by this test file
    const lines = readFileSync(
      new URL('../fixtures/simulated-transitions.jsonl', import.meta.url),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const record = JSON.parse(line) as { readonly reasonCode: string };
      expect(reasonTextOf(record.reasonCode)).not.toContain('no plain text yet');
    }
  });
});

describe('the owner approval token', () => {
  it('sits on the approval card while a high-value payment waits for the owner', () => {
    expect(nodeOf('SUBMITTED', 'submitter', OWNER_WAIT_REASON)).toBe('approver');
  });

  it('sits on the ledger for an ordinary submission, and after the owner signs', () => {
    expect(nodeOf('SUBMITTED', 'submitter', 'SENT')).toBe('ledger');
    expect(nodeOf('VALIDATED', 'warden', 'PAID')).toBe('ledger');
  });
});
