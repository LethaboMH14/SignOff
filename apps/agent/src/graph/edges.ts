/**
 * The typed state graph. Nodes and edges are listed here, and a move that is not an edge in this table throws before it
 * happens. The judge can only choose among the edges its action maps to (JUDGE_EDGE), and nothing can reach the payment
 * nodes except through ACCEPT from the judge.
 *
 * Deviation from the plan's order (recorded in the ADR): route runs after verify, not before extract. The route needs the
 * printed payee account (bank change) and the verified total (amount band), and those exist only after extraction.
 */

export const NODES = [
  'intake',
  'classify',
  'extract',
  'verify',
  'route',
  'match',
  'review',
  'judge',
  'warden',
  'sign',
  'submit',
  'reconcile',
] as const;
export type NodeName = (typeof NODES)[number];

export const TERMINALS = ['paid', 'held', 'refused', 'needs-person', 'eligible'] as const;
export type Terminal = (typeof TERMINALS)[number];

export type Move = NodeName | Terminal;

export const EDGES: Readonly<Record<NodeName, readonly Move[]>> = {
  intake: ['classify', 'refused'],
  classify: ['extract', 'held'],
  extract: ['verify', 'held'],
  verify: ['route', 'held'],
  route: ['match', 'held'],
  match: ['review', 'held'],
  review: ['judge', 'held'],
  judge: ['review', 'warden', 'held'],
  warden: ['sign', 'held', 'eligible'],
  sign: ['submit', 'needs-person'],
  submit: ['reconcile', 'needs-person'],
  reconcile: ['paid', 'needs-person'],
};

export type JudgeMove = 'review' | 'warden' | 'held';

/** The only edges the judge may take, one per action. A HOLD goes to the held terminal and nowhere else. */
export const JUDGE_EDGE: Readonly<
  Record<'ACCEPT' | 'REPAIR' | 'ADD_REVIEWER' | 'HOLD', JudgeMove>
> = {
  ACCEPT: 'warden',
  REPAIR: 'review',
  ADD_REVIEWER: 'review',
  HOLD: 'held',
};

export class EdgeError extends Error {
  constructor(from: Move, to: Move) {
    super(`the move from ${from} to ${to} is not an edge of the graph`);
    this.name = 'EdgeError';
  }
}

export function assertEdge(from: NodeName, to: Move): void {
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  if (!EDGES[from].includes(to)) {
    throw new EdgeError(from, to);
  }
}

export function isTerminal(move: Move): move is Terminal {
  return (TERMINALS as readonly string[]).includes(move);
}
