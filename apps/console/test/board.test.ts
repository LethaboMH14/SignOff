import { describe, expect, it } from 'vitest';

import {
  applyMovement,
  emptyBoard,
  HISTORY_LIMIT,
  TOKEN_LIMIT,
  type BoardState,
} from '../src/model/board.js';
import { toMovement, type MapEventInput, type Movement } from '../src/model/states.js';

function moveOf(
  seq: number,
  invoice: string,
  toState: MapEventInput['toState'],
  actor: MapEventInput['actor'],
): Movement {
  return toMovement({
    seq,
    at: '2026-11-10T10:00:00.000Z',
    correlationId: invoice.repeat(64).slice(0, 64),
    fromState: null,
    toState,
    actor,
    reasonCode: 'OK',
    policyVersion: '2026-11-10.1',
  });
}

function applyAll(board: BoardState, moves: readonly Movement[]): BoardState {
  return moves.reduce((current, move) => applyMovement(current, move).board, board);
}

describe('the board', () => {
  it('starts an invoice from the arrival point, then moves it from where it was', () => {
    const first = applyMovement(emptyBoard(), moveOf(1, '1', 'RECEIVED', 'intake'));
    expect(first.applied).toBe(true);
    expect(first.from).toBe('arrival');
    const second = applyMovement(first.board, moveOf(2, '1', 'EXTRACTED', 'extractor'));
    expect(second.from).toBe('intake');
    expect(second.board.tokens['11111111']?.node).toBe('extractor');
  });

  it('ignores a move it has already applied, so a reconnect shows nothing twice', () => {
    const once = applyMovement(emptyBoard(), moveOf(1, '1', 'RECEIVED', 'intake'));
    const again = applyMovement(once.board, moveOf(1, '1', 'RECEIVED', 'intake'));
    expect(again.applied).toBe(false);
    expect(again.board).toBe(once.board);
  });

  it('keeps the history newest first, and the active place at the latest move', () => {
    const board = applyAll(emptyBoard(), [
      moveOf(1, '1', 'RECEIVED', 'intake'),
      moveOf(2, '2', 'RECEIVED', 'intake'),
      moveOf(3, '1', 'EXTRACTED', 'extractor'),
    ]);
    expect(board.history.map((move) => move.seq)).toEqual([3, 2, 1]);
    expect(board.activeNode).toBe('extractor');
    expect(board.lastSeq).toBe(3);
  });

  it('keeps only the most recent tokens and history, so the map stays readable', () => {
    const moves: Movement[] = [];
    for (let index = 1; index <= TOKEN_LIMIT + 5; index += 1) {
      moves.push(moveOf(index, String((index % 9) + 1), 'RECEIVED', 'intake'));
    }
    const many: Movement[] = [];
    for (let index = 1; index <= HISTORY_LIMIT + 10; index += 1) {
      many.push(moveOf(index, String((index % 9) + 1), 'RECEIVED', 'intake'));
    }
    expect(Object.keys(applyAll(emptyBoard(), moves).tokens).length).toBeLessThanOrEqual(
      TOKEN_LIMIT,
    );
    expect(applyAll(emptyBoard(), many).history).toHaveLength(HISTORY_LIMIT);
  });
});
