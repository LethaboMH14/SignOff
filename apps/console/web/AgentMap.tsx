import type { BoardState, TokenState } from '../src/model/board.js';
import {
  EDGES,
  labelOf,
  MAP_NODES,
  pointOf,
  tokenPosition,
  VIEW_HEIGHT,
  VIEW_WIDTH,
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
      <g className="edges">
        {EDGES.map((edge) => {
          const from = pointOf(edge.from);
          const to = pointOf(edge.to);
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={`edge edge-${edge.kind}`}
            />
          );
        })}
      </g>
      <g className="nodes">
        {MAP_NODES.map((node) => {
          const point = pointOf(node);
          const active = board.activeNode === node;
          const radius = node === 'arrival' ? 14 : 30;
          return (
            <g
              key={node}
              className={`node node-${node}${active ? ' node-active' : ''}`}
              transform={`translate(${String(point.x)} ${String(point.y)})`}
            >
              <circle r={radius} className="node-disc" />
              {active ? <circle r={30} className="node-pulse" /> : null}
              <text y={node === 'arrival' ? -22 : 52} textAnchor="middle" className="node-label">
                {labelOf(node)}
              </text>
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
              <circle r={15} className="token-disc" />
              <text y={5} textAnchor="middle" className="token-glyph" aria-hidden="true">
                {TONE_GLYPHS[token.tone]}
              </text>
              <text y={34} textAnchor="middle" className="token-id">
                {token.invoice.slice(0, 4)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
