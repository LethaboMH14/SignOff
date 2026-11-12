import { useEffect, useReducer } from 'react';

import { applyMovement, emptyBoard, type BoardState } from '../src/model/board.js';
import { parseMapEvent, toMovement, type MapEventInput } from '../src/model/states.js';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export interface StreamState {
  readonly board: BoardState;
  readonly status: ConnectionStatus;
  readonly mode: string | null;
  readonly damaged: number;
}

export type StreamAction =
  | { readonly type: 'movement'; readonly event: MapEventInput }
  | { readonly type: 'status'; readonly status: ConnectionStatus }
  | { readonly type: 'hello'; readonly mode: string }
  | { readonly type: 'damaged'; readonly count: number }
  | { readonly type: 'damagedTotal'; readonly count: number }
  | { readonly type: 'idle' };

export const INITIAL_STREAM: StreamState = {
  board: emptyBoard(),
  status: 'connecting',
  mode: null,
  damaged: 0,
};

/** Pure: the same actions always give the same state. */
export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'movement': {
      const result = applyMovement(state.board, toMovement(action.event));
      return result.applied ? { ...state, board: result.board } : state;
    }
    case 'status':
      return { ...state, status: action.status };
    case 'hello':
      return { ...state, mode: action.mode, status: 'live' };
    case 'damaged':
      return { ...state, damaged: state.damaged + action.count };
    case 'damagedTotal':
      return { ...state, damaged: action.count };
    case 'idle':
      return { ...state, board: { ...state.board, activeNode: null } };
  }
}

/** How long the map keeps a place marked as working after its last move. */
export const WORKING_MARK_MS = 1600;

/** How often the map asks the server for moves it has not shown yet. */
export const POLL_MS = 1500;

interface PollBody {
  readonly mode: string;
  readonly damaged: number;
  readonly events: readonly unknown[];
}

function isPollBody(value: unknown): value is PollBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    typeof value.mode === 'string' &&
    'damaged' in value &&
    typeof value.damaged === 'number' &&
    'events' in value &&
    Array.isArray(value.events)
  );
}

/**
 * Follows the server's log by asking for the moves after the last one shown. It asks again after POLL_MS, so it works on
 * hosts that cannot hold a connection open. A failed request shows as reconnecting, and the next request tries again.
 */
export function useEventStream(url: string): StreamState {
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM);

  useEffect(() => {
    let after = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`${url}?after=${String(after)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${String(response.status)}`);
        }
        const body: unknown = await response.json();
        if (stopped || !isPollBody(body)) {
          return;
        }
        dispatch({ type: 'status', status: 'live' });
        dispatch({ type: 'hello', mode: body.mode });
        dispatch({ type: 'damagedTotal', count: body.damaged });
        for (const raw of body.events) {
          const event = parseMapEvent(raw);
          if (event !== null) {
            dispatch({ type: 'movement', event });
            after = event.seq;
          }
        }
      } catch {
        if (!stopped) {
          dispatch({ type: 'status', status: 'reconnecting' });
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(() => {
            void poll();
          }, POLL_MS);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [url]);

  const activeNode = state.board.activeNode;
  const lastSeq = state.board.lastSeq;
  useEffect(() => {
    if (activeNode === null) {
      return;
    }
    const timer = setTimeout(() => {
      dispatch({ type: 'idle' });
    }, WORKING_MARK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [activeNode, lastSeq]);

  return state;
}
