import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { applyMovement, emptyBoard, type BoardState } from '../src/model/board.js';
import { toMovement, type MapEventInput } from '../src/model/states.js';
import { AgentMap } from '../web/AgentMap.js';
import { clockOf, Feed } from '../web/Feed.js';

const HASH_HELD = `1${'0'.repeat(63)}`;
const HASH_OK = `2${'0'.repeat(63)}`;

function eventOf(
  seq: number,
  correlationId: string,
  toState: MapEventInput['toState'],
  actor: MapEventInput['actor'],
  reasonCode: string,
): MapEventInput {
  return {
    seq,
    at: '2026-11-10T10:00:00.000Z',
    correlationId,
    fromState: null,
    toState,
    actor,
    reasonCode,
    policyVersion: '2026-11-10.1',
  };
}

function boardWith(events: readonly MapEventInput[]): BoardState {
  return events.reduce(
    (board, event) => applyMovement(board, toMovement(event)).board,
    emptyBoard(),
  );
}

describe('the agent map', () => {
  const board = boardWith([
    eventOf(1, HASH_OK, 'RECEIVED', 'intake', 'OK'),
    eventOf(2, HASH_HELD, 'QUARANTINED', 'screen', 'INSTRUCTION_LIKE_TEXT'),
    eventOf(3, HASH_OK, 'SUBMITTED', 'submitter', 'OK'),
  ]);

  it('names every place and says what is on the map, in words', () => {
    const markup = renderToStaticMarkup(<AgentMap board={board} />);
    expect(markup).toContain('XRP Ledger (Testnet)');
    expect(markup).toContain('Held for a person');
    expect(markup).toContain('Paid: validated and reconciled');
    expect(markup).toContain('2 invoices on the map');
  });

  it('shows each invoice with its state in words, and with a symbol that is hidden from assistive technology', () => {
    const markup = renderToStaticMarkup(<AgentMap board={board} />);
    expect(markup).toContain('Invoice 10000000: Quarantined: not read. Held.');
    expect(markup).toContain('Invoice 20000000: Submitted, awaiting validation. Submitted.');
    expect(markup).toContain('class="token-glyph" aria-hidden="true">!</text>');
    expect(markup).toContain('tone-hold');
  });

  it('describes an empty map in words', () => {
    expect(renderToStaticMarkup(<AgentMap board={emptyBoard()} />)).toContain('no moves yet');
  });
});

describe('the feed', () => {
  it('shows the plain reason for a hold, and leaves out the reason of a clean step', () => {
    const movements = [
      toMovement(eventOf(2, HASH_HELD, 'QUARANTINED', 'screen', 'INSTRUCTION_LIKE_TEXT')),
      toMovement(eventOf(1, HASH_OK, 'RECEIVED', 'intake', 'OK')),
    ];
    const markup = renderToStaticMarkup(<Feed movements={movements} />);
    expect(markup).toContain('The invoice text contains instruction-like wording');
    expect(markup).not.toContain('No problem found at this step.');
    expect(markup).toContain('Held');
  });

  it('can take keyboard focus, because the list scrolls inside its own box', () => {
    const movements = [toMovement(eventOf(1, HASH_OK, 'RECEIVED', 'intake', 'OK'))];
    expect(renderToStaticMarkup(<Feed movements={movements} />)).toMatch(
      /<ol class="feed"[^>]*tabindex="0"/,
    );
  });

  it('says so when there is nothing to show yet', () => {
    expect(renderToStaticMarkup(<Feed movements={[]} />)).toContain('No moves yet');
  });

  it('shows the time in South African time, and a dash when the time is not valid', () => {
    expect(clockOf('2026-11-10T10:00:00.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(clockOf('not a time')).toBe('--:--:--');
  });
});
