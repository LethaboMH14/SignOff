import { ACTOR_LABELS, type AgentActor, type MapNode } from './states.js';

/**
 * The map's fixed geometry. The agents form one lane in pipeline order. Held moves leave the lane downwards, the ledger
 * sits below the submitter, and the paid end sits above the reconciler. Coordinates are in SVG user units.
 */

export const VIEW_WIDTH = 1200;
export const VIEW_HEIGHT = 560;

export interface Point {
  readonly x: number;
  readonly y: number;
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
  arrival: { x: 40, y: 300 },
  intake: { x: 120, y: 300 },
  screen: { x: 240, y: 300 },
  extractor: { x: 360, y: 300 },
  verifier: { x: 480, y: 300 },
  matcher: { x: 600, y: 300 },
  warden: { x: 720, y: 300 },
  signer: { x: 840, y: 300 },
  submitter: { x: 960, y: 300 },
  reconciler: { x: 1080, y: 300 },
  hold: { x: 480, y: 470 },
  ledger: { x: 960, y: 470 },
  paid: { x: 1080, y: 120 },
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

/** The words written beside a node. */
export function labelOf(node: MapNode): string {
  // eslint-disable-next-line security/detect-object-injection -- the key is the closed MapNode union, checked by the compiler
  return LABELS[node];
}

export interface Edge {
  readonly from: MapNode;
  readonly to: MapNode;
  readonly kind: 'lane' | 'branch';
}

export const EDGES: readonly Edge[] = [
  { from: 'arrival', to: 'intake', kind: 'lane' },
  { from: 'intake', to: 'screen', kind: 'lane' },
  { from: 'screen', to: 'extractor', kind: 'lane' },
  { from: 'extractor', to: 'verifier', kind: 'lane' },
  { from: 'verifier', to: 'matcher', kind: 'lane' },
  { from: 'matcher', to: 'warden', kind: 'lane' },
  { from: 'warden', to: 'signer', kind: 'lane' },
  { from: 'signer', to: 'submitter', kind: 'lane' },
  { from: 'submitter', to: 'reconciler', kind: 'lane' },
  { from: 'screen', to: 'hold', kind: 'branch' },
  { from: 'verifier', to: 'hold', kind: 'branch' },
  { from: 'warden', to: 'hold', kind: 'branch' },
  { from: 'submitter', to: 'ledger', kind: 'branch' },
  { from: 'ledger', to: 'reconciler', kind: 'branch' },
  { from: 'reconciler', to: 'paid', kind: 'branch' },
];

/** Tokens that share a place are spread sideways so each one stays visible. */
const TOKEN_SPREAD = 26;

/** Where the token in a given slot of a place is drawn: above the place, spread sideways. */
export function tokenPosition(node: MapNode, slot: number): Point {
  const base = pointOf(node);
  const step = Math.ceil(slot / 2) * TOKEN_SPREAD;
  const offset = slot % 2 === 1 ? step : -step;
  return { x: base.x + (slot === 0 ? 0 : offset), y: base.y - 46 };
}

export function isActorNode(node: MapNode): node is AgentActor {
  return Object.prototype.hasOwnProperty.call(ACTOR_LABELS, node);
}
