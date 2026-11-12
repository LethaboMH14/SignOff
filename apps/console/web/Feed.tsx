import { TONE_GLYPHS, TONE_WORDS } from './AgentMap.js';
import { ACTOR_LABELS, type Movement } from '../src/model/states.js';

const CLOCK = new Intl.DateTimeFormat('en-ZA', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Africa/Johannesburg',
});

/** The time in South African time, the timezone the project reports in. */
export function clockOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '--:--:--' : CLOCK.format(date);
}

export function Feed({ movements }: { readonly movements: readonly Movement[] }) {
  if (movements.length === 0) {
    return <p className="feed-empty">No moves yet. The list fills in as the agents work.</p>;
  }
  return (
    <ol className="feed" aria-label="Latest moves, newest first">
      {movements.map((move) => (
        <li key={move.seq} className={`feed-item tone-${move.tone}`}>
          <div className="feed-head">
            <time dateTime={move.at}>{clockOf(move.at)} SAST</time>
            <span className="feed-tone">
              <span aria-hidden="true">{TONE_GLYPHS[move.tone]}</span> {TONE_WORDS[move.tone]}
            </span>
          </div>
          <div className="feed-line">
            Invoice {move.invoice}, {ACTOR_LABELS[move.actor]}: {move.label}
          </div>
          {move.reasonCode === 'OK' ? null : <div className="feed-reason">{move.reason}</div>}
        </li>
      ))}
    </ol>
  );
}
