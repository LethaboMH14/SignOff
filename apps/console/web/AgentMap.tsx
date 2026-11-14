import type { BoardState, TokenState } from '../src/model/board.js';
import type { Movement } from '../src/model/states.js';
import {
  ARRIVAL_RADIUS,
  EDGES,
  edgeEnds,
  labelOf,
  MAP_NODES,
  pointOf,
  sizeOf,
  tokenPosition,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  ZONES,
  type Point,
} from '../src/model/layout.js';
import { ACTOR_LABELS, type MapNode, type Tone } from '../src/model/states.js';

/** Each tone has a word and a symbol as well as a colour, so the map never relies on colour alone. */
export const TONE_WORDS: Readonly<Record<Tone, string>> = {
  progress: 'In progress',
  submitted: 'Submitted',
  hold: 'Held',
  paid: 'Paid',
  failed: 'Failed',
};

export const TONE_GLYPHS: Readonly<Record<Tone, string>> = {
  progress: '•',
  submitted: '◷',
  hold: '!',
  paid: '✓',
  failed: '×',
};

function placesOf(tokens: readonly TokenState[]): ReadonlyMap<string, Point> {
  const countPerNode = new Map<MapNode, number>();
  const places = new Map<string, Point>();
  for (const token of tokens) {
    const slot = countPerNode.get(token.node) ?? 0;
    countPerNode.set(token.node, slot + 1);
    places.set(token.invoice, tokenPosition(token.node, slot));
  }
  return places;
}

function summaryOf(board: BoardState, tokenCount: number): string {
  const latest = board.history[0];
  if (latest === undefined) {
    return 'The map has no moves yet. Invoices appear here as the agents work on them.';
  }
  return `${String(tokenCount)} invoices on the map. The latest move: invoice ${latest.invoice}, ${ACTOR_LABELS[latest.actor]}, ${latest.label}.`;
}

/**
 * The places where the owner was told something recently. Every logged move except the ledger's validation has a
 * notice, so a bell on a place means a move happened there in the recent history. The bell is a reading of the log,
 * not a delivery receipt; the owner's messages live in the notification log and on Telegram.
 */
export function notifiedPlacesOf(history: readonly Movement[]): ReadonlySet<MapNode> {
  const places = new Set<MapNode>();
  for (const move of history) {
    if (move.toState !== 'VALIDATED') {
      places.add(move.node);
    }
  }
  return places;
}

export function AgentMap({ board }: { readonly board: BoardState }) {
  const tokens = Object.values(board.tokens).sort((a, b) => a.seq - b.seq);
  const places = placesOf(tokens);
  const notified = notifiedPlacesOf(board.history);
  return (
    <svg
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
      role="img"
      aria-label={summaryOf(board, tokens.length)}
      className="agent-map"
    >
      <defs>
        <marker
          id="map-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 Z" className="edge-arrow" />
        </marker>
        <marker
          id="map-arrow-branch"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 Z" className="edge-arrow-branch" />
        </marker>
      </defs>
      <g className="zones">
        {ZONES.map((zone) => (
          <g key={zone.id} className={`zone zone-${zone.id}`}>
            <rect
              x={zone.x}
              y={zone.y}
              width={zone.width}
              height={zone.height}
              rx={22}
              className="zone-box"
            />
            <text x={zone.x + 4} y={zone.y - 16} className="zone-title">
              {zone.title}
            </text>
          </g>
        ))}
      </g>
      <g className="edges">
        {EDGES.map((edge) => {
          const { from, to } = edgeEnds(edge);
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={`edge edge-${edge.kind}${board.activeNode === edge.to ? ' edge-live' : ''}`}
              markerEnd={edge.kind === 'branch' ? 'url(#map-arrow-branch)' : 'url(#map-arrow)'}
            />
          );
        })}
      </g>
      <g className="nodes">
        {MAP_NODES.map((node) => {
          const point = pointOf(node);
          const active = board.activeNode === node;
          const { width, height } = sizeOf(node);
          return (
            <g
              key={node}
              className={`node node-${node}${active ? ' node-active' : ''}`}
              transform={`translate(${String(point.x)} ${String(point.y)})`}
            >
              {node === 'arrival' ? (
                <>
                  <circle r={ARRIVAL_RADIUS} className="node-disc" />
                  <text y={34} textAnchor="middle" className="node-caption">
                    {labelOf(node)}
                  </text>
                </>
              ) : (
                <>
                  {active ? (
                    <rect
                      x={-width / 2 - 6}
                      y={-height / 2 - 6}
                      width={width + 12}
                      height={height + 12}
                      rx={18}
                      className="node-pulse"
                    />
                  ) : null}
                  <rect
                    x={-width / 2}
                    y={-height / 2}
                    width={width}
                    height={height}
                    rx={14}
                    className="node-disc"
                  />
                  <text y={5} textAnchor="middle" className="node-label">
                    {labelOf(node)}
                  </text>
                  {notified.has(node) ? (
                    <g
                      className="node-bell"
                      transform={`translate(${String(width / 2 - 2)} ${String(-height / 2 + 2)})`}
                    >
                      <title>The owner was told about this step.</title>
                      <circle r={11} fill="#E3A33B" stroke="#15211C" strokeWidth={1.5} />
                      <path
                        d="M-4 3 L-4 -1 Q-4 -5 0 -5 Q4 -5 4 -1 L4 3 L5 5 L-5 5 Z M-1.5 6.5 Q0 8 1.5 6.5"
                        fill="#15211C"
                      />
                    </g>
                  ) : null}
                </>
              )}
            </g>
          );
        })}
      </g>
      <g className="tokens">
        {tokens.map((token) => {
          const point = places.get(token.invoice) ?? pointOf('arrival');
          return (
            <g
              key={token.invoice}
              className={`token tone-${token.tone}`}
              style={{ transform: `translate(${String(point.x)}px, ${String(point.y)}px)` }}
            >
              <title>{`Invoice ${token.invoice}: ${token.label}. ${TONE_WORDS[token.tone]}.`}</title>
              <circle r={13} className="token-disc" />
              <text y={5} textAnchor="middle" className="token-glyph" aria-hidden="true">
                {TONE_GLYPHS[token.tone]}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
