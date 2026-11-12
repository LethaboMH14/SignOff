import { describe, expect, it } from 'vitest';

import { INITIAL_STREAM, streamReducer } from '../web/useEventStream.js';

describe('the map stream state', () => {
  it('sets the damaged-line count to the total the server reports, rather than adding to it', () => {
    const once = streamReducer(INITIAL_STREAM, { type: 'damagedTotal', count: 2 });
    const again = streamReducer(once, { type: 'damagedTotal', count: 2 });
    expect(again.damaged).toBe(2);
  });

  it('keeps the older increment action for the stream events that still add counts', () => {
    const state = streamReducer(INITIAL_STREAM, { type: 'damaged', count: 1 });
    expect(streamReducer(state, { type: 'damaged', count: 2 }).damaged).toBe(3);
  });

  it('marks the connection live and records the mode when a poll answers', () => {
    const state = streamReducer(INITIAL_STREAM, { type: 'hello', mode: 'simulated' });
    expect(state).toMatchObject({ mode: 'simulated', status: 'live' });
  });
});
