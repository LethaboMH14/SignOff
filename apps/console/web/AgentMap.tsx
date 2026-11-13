import type { BoardState, TokenState } from '../src/model/board.js';
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

export function AgentMap({ board }: { readonly board: BoardState }) {
  const tokens = Object.values(board.tokens).sort((a, b) => a.seq - b.seq);
  const places = placesOf(tokens);
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
