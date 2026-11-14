import { describe, expect, it } from 'vitest';

import { type Movement } from '../src/model/states.js';
import { lastMoveLabel } from '../web/MapView.js';

describe('the agent map status line', () => {
  it('says when the newest agent move happened, in South African time', () => {
    const moves = [
      { at: '2026-11-13T00:22:46.734Z' },
      { at: '2026-11-13T00:23:00.473Z' },
    ] as unknown as readonly Movement[];
    expect(lastMoveLabel(moves)).toBe('Last agent move 02:23:00 SAST');
  });

  it('says plainly when no agent move has happened yet', () => {
    expect(lastMoveLabel([])).toBe('No agent move yet');
  });
});
