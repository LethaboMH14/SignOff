import type { MapNode, Movement, Tone } from './states.js';

/**
 * The board: where each invoice's token is, and the recent history. A pure reducer, so the same events always give the
 * same board, and a replayed event that was already applied changes nothing.
 */

export const HISTORY_LIMIT = 40;
export const TOKEN_LIMIT = 14;

export interface TokenState {
  readonly invoice: string;
  readonly node: MapNode;
  readonly label: string;
  readonly tone: Tone;
  readonly seq: number;
}

export interface BoardState {
  readonly tokens: Readonly<Record<string, TokenState>>;
  /** Newest first. */
  readonly history: readonly Movement[];
  readonly lastSeq: number;
  /** The place where the latest move happened, so the map can show it working. */
  readonly activeNode: MapNode | null;
}

export interface ApplyResult {
  readonly board: BoardState;
  readonly applied: boolean;
  /** The place the token came from. The first move of an invoice comes from the arrival point. */
  readonly from: MapNode;
}

export function emptyBoard(): BoardState {
  return { tokens: {}, history: [], lastSeq: 0, activeNode: null };
}

function keepRecent(
  tokens: Readonly<Record<string, TokenState>>,
): Readonly<Record<string, TokenState>> {
  const newest = Object.values(tokens)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, TOKEN_LIMIT);
  return Object.fromEntries(newest.map((token) => [token.invoice, token]));
}

export function applyMovement(board: BoardState, movement: Movement): ApplyResult {
  if (movement.seq <= board.lastSeq) {
    return { board, applied: false, from: movement.node };
  }
  const previous = board.tokens[movement.invoice];
  const from: MapNode = previous?.node ?? 'arrival';
  const token: TokenState = {
    invoice: movement.invoice,
    node: movement.node,
    label: movement.label,
    tone: movement.tone,
    seq: movement.seq,
  };
  return {
    applied: true,
    from,
    board: {
      tokens: keepRecent({ ...board.tokens, [movement.invoice]: token }),
      history: [movement, ...board.history].slice(0, HISTORY_LIMIT),
      lastSeq: movement.seq,
      activeNode: movement.node,
    },
  };
}
