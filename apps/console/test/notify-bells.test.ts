import { describe, expect, it } from 'vitest';

import { notifiedPlacesOf } from '../web/AgentMap.js';
import type { Movement } from '../src/model/states.js';

const move = (node: Movement['node'], toState: Movement['toState']): Movement => ({
  node,
  toState,
  seq: 1,
  at: '2026-11-13T19:00:00.000Z',
  invoice: 'abc',
  actor: 'intake',
  label: '',
  tone: 'progress',
  reasonCode: 'OK',
  reason: '',
});

describe('the owner bells on the map', () => {
  it('rings at each place a notified step happened', () => {
    const places = notifiedPlacesOf([move('intake', 'RECEIVED'), move('warden', 'SIGNED')]);
    expect([...places].sort()).toEqual(['intake', 'warden']);
  });

  it('does not ring for the ledger validation, which the owner is not told about', () => {
    const places = notifiedPlacesOf([move('ledger', 'VALIDATED')]);
    expect(places.size).toBe(0);
  });

  it('rings for the paid step, which the owner is told about with the proof link', () => {
    expect(notifiedPlacesOf([move('paid', 'RECONCILED')]).has('paid')).toBe(true);
  });
});
