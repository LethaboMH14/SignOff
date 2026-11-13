import { useState } from 'react';

import { type Movement } from '../src/model/states.js';
import { AgentMap } from './AgentMap.js';
import { Feed } from './Feed.js';
import { type ConnectionStatus, useEventStream } from './useEventStream.js';

const STATUS_WORDS: Readonly<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting',
  live: 'Connected',
  reconnecting: 'Reconnecting',
};

const STATUS_GLYPHS: Readonly<Record<ConnectionStatus, string>> = {
  connecting: '◷',
  live: '●',
  reconnecting: '!',
};

const MODE_WORDS: Readonly<Record<string, string>> = {
  simulated: 'SIMULATED replay of a labelled run',
  live: 'Live data from the agent log',
};

const SAST_CLOCK = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** When the newest agent move happened, in South African time, or a plain statement that there is none yet. */
export function lastMoveLabel(moves: readonly Movement[]): string {
  let newest: string | null = null;
  for (const move of moves) {
    if (newest === null || move.at > newest) {
      newest = move.at;
    }
  }
  return newest === null
    ? 'No agent move yet'
    : `Last agent move ${SAST_CLOCK.format(new Date(newest))} SAST`;
}

/** The agents' map and the feed of what happened, from the console's event stream. */
export function MapView() {
  const stream = useEventStream('/api/events');
  const [frozen, setFrozen] = useState<readonly Movement[] | null>(null);
  const movements = frozen ?? stream.board.history;
  const modeWord =
    stream.mode === null ? 'Waiting for the server' : (MODE_WORDS[stream.mode] ?? stream.mode);

  return (
    <>
      <div className="status" role="status" aria-live="polite">
        <span className={`badge badge-${stream.status}`}>
          <span aria-hidden="true">{STATUS_GLYPHS[stream.status]}</span>{' '}
          {STATUS_WORDS[stream.status]}
        </span>
        <span className="badge">{modeWord}</span>
        <span className="badge">{lastMoveLabel(stream.board.history)}</span>
        {stream.damaged > 0 ? (
          <span className="badge badge-warn">
            <span aria-hidden="true">!</span> {String(stream.damaged)} damaged lines skipped
          </span>
        ) : null}
      </div>

      <div className="layout">
        <section className="panel" aria-labelledby="map-title">
          <h2 id="map-title">Where each invoice is</h2>
          <p className="lede">
            Each token is one invoice. It moves to the agent that has just acted on it. Amber means
            held for a person. Paid appears only after the ledger validates the payment and
            reconciliation records it.
          </p>
          <div className="map-scroll">
            <AgentMap board={stream.board} />
          </div>
        </section>

        <aside className="panel" aria-labelledby="feed-title">
          <div className="feed-bar">
            <h2 id="feed-title">What happened</h2>
            <button
              type="button"
              aria-pressed={frozen !== null}
              onClick={() => {
                setFrozen(frozen === null ? stream.board.history : null);
              }}
            >
              {frozen === null ? 'Freeze the list' : 'Resume the list'}
            </button>
          </div>
          <Feed movements={movements} />
        </aside>
      </div>
    </>
  );
}
