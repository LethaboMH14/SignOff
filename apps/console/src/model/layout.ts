import { ACTOR_LABELS, type AgentActor, type MapNode } from './states.js';

/**
 * The map's fixed geometry, drawn as a graph of agents rather than one lane. Three zones show who does what: the AI
 * agents read and check the invoice, the Warden decides on its own, and the ledger side signs, settles and reconciles.
 * Every node is a card sized to its label, so no label overlaps a line, a token or another card. Coordinates are in SVG
 * user units.
 */

export const VIEW_WIDTH = 1260;
export const VIEW_HEIGHT = 640;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Every place on the map, in the order the map draws them. */
export const MAP_NODES: readonly MapNode[] = [
  'arrival',
  'intake',
  'screen',
  'extractor',
  'verifier',
  'matcher',
  'warden',
  'signer',
  'submitter',
  'reconciler',
  'hold',
  'ledger',
  'paid',
];

const POSITIONS: Readonly<Record<MapNode, Point>> = {
  arrival: { x: 62, y: 330 },
  intake: { x: 175, y: 330 },
  screen: { x: 320, y: 190 },
  extractor: { x: 505, y: 190 },
  verifier: { x: 320, y: 370 },
  matcher: { x: 505, y: 370 },
  warden: { x: 765, y: 330 },
  signer: { x: 960, y: 190 },
  submitter: { x: 1150, y: 190 },
  reconciler: { x: 960, y: 370 },
  ledger: { x: 1150, y: 370 },
  hold: { x: 175, y: 525 },
  paid: { x: 1065, y: 525 },
};

const LABELS: Readonly<Record<MapNode, string>> = {
  arrival: 'Arrives',
  intake: ACTOR_LABELS.intake,
  screen: ACTOR_LABELS.screen,
  extractor: ACTOR_LABELS.extractor,
  verifier: ACTOR_LABELS.verifier,
  matcher: ACTOR_LABELS.matcher,
  warden: ACTOR_LABELS.warden,
  signer: ACTOR_LABELS.signer,
  submitter: ACTOR_LABELS.submitter,
  reconciler: ACTOR_LABELS.reconciler,
  hold: 'Held for a person',
  ledger: 'XRP Ledger (Testnet)',
  paid: 'Paid: validated and reconciled',
};

/** The place of a node. The key is a closed union that the compiler checks, so it cannot be anything else. */
export function pointOf(node: MapNode): Point {
  // eslint-disable-next-line security/detect-object-injection -- the key is the closed MapNode union, checked by the compiler
  return POSITIONS[node];
}

/** The words written on a node's card. */
export function labelOf(node: MapNode): string {
  // eslint-disable-next-line security/detect-object-injection -- the key is the closed MapNode union, checked by the compiler
  return LABELS[node];
}

/** The arrival point is a small dot; every other node is a card wide enough for its label at 15 px. */
export const ARRIVAL_RADIUS = 10;
const CARD_HEIGHT = 48;

export function sizeOf(node: MapNode): Size {
  if (node === 'arrival') {
    return { width: ARRIVAL_RADIUS * 2, height: ARRIVAL_RADIUS * 2 };
  }
  return { width: Math.max(124, Math.round(labelOf(node).length * 7.6 + 36)), height: CARD_HEIGHT };
}

export interface Edge {
  readonly from: MapNode;
  readonly to: MapNode;
  readonly kind: 'lane' | 'branch';
}

/** The order the agent moves an invoice in, plus the branches to a hold. */
export const EDGES: readonly Edge[] = [
  { from: 'arrival', to: 'intake', kind: 'lane' },
  { from: 'intake', to: 'screen', kind: 'lane' },
  { from: 'screen', to: 'extractor', kind: 'lane' },
  { from: 'extractor', to: 'verifier', kind: 'lane' },
  { from: 'verifier', to: 'matcher', kind: 'lane' },
  { from: 'matcher', to: 'warden', kind: 'lane' },
  { from: 'warden', to: 'signer', kind: 'lane' },
  { from: 'signer', to: 'submitter', kind: 'lane' },
  { from: 'submitter', to: 'ledger', kind: 'lane' },
  { from: 'ledger', to: 'reconciler', kind: 'lane' },
  { from: 'reconciler', to: 'paid', kind: 'lane' },
  { from: 'screen', to: 'hold', kind: 'branch' },
  { from: 'verifier', to: 'hold', kind: 'branch' },
  { from: 'warden', to: 'hold', kind: 'branch' },
];

export interface Zone {
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The three zones. Titles are drawn above each zone, never on top of a card. */
export const ZONES: readonly Zone[] = [
  {
    id: 'agents',
    title: 'AI agents: read and check',
    x: 20,
    y: 110,
    width: 620,
    height: 500,
  },
  { id: 'warden', title: 'Warden: own rules', x: 668, y: 110, width: 194, height: 500 },
  {
    id: 'ledger',
    title: 'Ledger: sign, settle, reconcile',
    x: 880,
    y: 110,
    width: 362,
    height: 500,
  },
];

/** Where an edge leaves or meets a node: on the edge of its card, with a small gap, so arrows never hide under it. */
function boundaryPoint(node: MapNode, toward: Point, gap: number): Point {
  const centre = pointOf(node);
  const { width, height } = sizeOf(node);
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (dx === 0 && dy === 0) {
    return centre;
  }
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : height / 2 / Math.abs(dy),
  );
  const length = Math.hypot(dx, dy);
  return {
    x: centre.x + dx * scale + (dx / length) * gap,
    y: centre.y + dy * scale + (dy / length) * gap,
  };
}

/** The two ends of an edge's line, clipped to the cards it joins. */
export function edgeEnds(edge: Edge): { readonly from: Point; readonly to: Point } {
  return {
    from: boundaryPoint(edge.from, pointOf(edge.to), 2),
    to: boundaryPoint(edge.to, pointOf(edge.from), 6),
  };
}

/** Tokens that share a place are spread sideways in a tray above the card, so each one stays visible. */
const TOKEN_SPREAD = 30;

export function tokenPosition(node: MapNode, slot: number): Point {
  const base = pointOf(node);
  const step = Math.ceil(slot / 2) * TOKEN_SPREAD;
  const offset = slot % 2 === 1 ? step : -step;
  // The two end cards take arrows from above, so their tray sits below them, clear of every arrow.
  const half = sizeOf(node).height / 2 + 20;
  const below = node === 'hold' || node === 'paid';
  return { x: base.x + (slot === 0 ? 0 : offset), y: below ? base.y + half : base.y - half };
}

export function isActorNode(node: MapNode): node is AgentActor {
  return Object.prototype.hasOwnProperty.call(ACTOR_LABELS, node);
}
