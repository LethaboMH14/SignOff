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
    case 'idle':
      return { ...state, board: { ...state.board, activeNode: null } };
  }
}

function parseData(message: MessageEvent<string>): unknown {
  try {
    return JSON.parse(message.data) as unknown;
  } catch {
    return null;
  }
}

/** How long the map keeps a place marked as working after its last move. */
export const WORKING_MARK_MS = 1600;

/** Follows the server's event stream. The browser reconnects by itself and resumes from the last id it saw. */
export function useEventStream(url: string): StreamState {
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM);

  useEffect(() => {
    const source = new EventSource(url);
    source.onopen = () => {
      dispatch({ type: 'status', status: 'live' });
    };
    source.onerror = () => {
      dispatch({ type: 'status', status: 'reconnecting' });
    };
    source.addEventListener('hello', (message: MessageEvent<string>) => {
      const data = parseData(message);
      if (
        typeof data === 'object' &&
        data !== null &&
        'mode' in data &&
        typeof data.mode === 'string'
      ) {
        dispatch({ type: 'hello', mode: data.mode });
      }
    });
    source.addEventListener('transition', (message: MessageEvent<string>) => {
      const event = parseMapEvent(parseData(message));
      if (event !== null) {
        dispatch({ type: 'movement', event });
      }
    });
    source.addEventListener('damaged', (message: MessageEvent<string>) => {
      const data = parseData(message);
      if (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        typeof data.count === 'number'
      ) {
        dispatch({ type: 'damaged', count: data.count });
      }
    });
    return () => {
      source.close();
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
