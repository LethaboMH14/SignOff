import { describe, expect, it } from 'vitest';

import { applyMovement, emptyBoard } from '../src/model/board.js';
import { AGENT_ACTORS, AGENT_STATES, parseMapEvent, toMovement } from '../src/model/states.js';
import { replayEvents } from '../web/replay.js';
import { assertTransition } from '../../agent/src/workflow/states.js';

const FIXED = (): Date => new Date('2026-11-13T08:00:00.000Z');
const ZERO = (): number => 0;

describe('the simulated replay', () => {
  it('takes a clean invoice through every allowed state to Paid', () => {
    const events = replayEvents('paid', 102, FIXED, ZERO);
    expect(events.map((event) => event.toState)).toEqual([
      'RECEIVED',
      'EXTRACTED',
      'EVIDENCE_VERIFIED',
      'WARDEN_ELIGIBLE',
      'SIGNED',
      'SUBMITTED',
      'VALIDATED',
      'RECONCILED',
    ]);
    for (const event of events) {
      expect(parseMapEvent(event)).not.toBeNull();
      expect(AGENT_STATES).toContain(event.toState);
      expect(AGENT_ACTORS).toContain(event.actor);
      expect(() => {
        assertTransition(event.fromState, event.toState);
      }).not.toThrow();
    }
  });

  it('quarantines the bank-detail change before anything reads it', () => {
    const events = replayEvents('fraud', 0, FIXED, ZERO);
    for (const event of events) {
      expect(() => {
        assertTransition(event.fromState, event.toState);
      }).not.toThrow();
    }
    expect(events.at(-1)?.toState).toBe('QUARANTINED');
    expect(events.at(-1)?.reasonCode).toBe('PAYEE_CHANGE_CLAIM');
  });

  it('numbers its moves after the last real one, so the board takes all of them', () => {
    const first = replayEvents('fraud', 0)[0];
    if (first === undefined) {
      throw new Error('the replay has no moves');
    }
    let board = emptyBoard();
    board = applyMovement(board, toMovement({ ...first, seq: 40 })).board;
    for (const event of replayEvents('paid', board.lastSeq)) {
      const result = applyMovement(board, toMovement(event));
      expect(result.applied).toBe(true);
      board = result.board;
    }
    expect(Object.values(board.tokens).some((token) => token.node === 'paid')).toBe(true);
    expect(board.lastSeq).toBe(48);
  });

  it('labels every move as a simulated replay', () => {
    expect(
      replayEvents('paid', 0).every((event) => event.policyVersion === 'simulated-replay'),
    ).toBe(true);
  });
});
