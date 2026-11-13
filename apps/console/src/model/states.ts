/**
 * The agent's states and actors, and the plain-language text the console shows for them. This module has no Node
 * imports, so the browser can use it. A test keeps its lists equal to the agent's own lists.
 */

import { reasonTextOf } from './reasons.js';

export { reasonTextOf };

export const AGENT_STATES = [
  'RECEIVED',
  'QUARANTINED',
  'EXTRACTED',
  'EVIDENCE_VERIFIED',
  'HELD',
  'WARDEN_ELIGIBLE',
  'SIGNED',
  'SUBMITTED',
  'VALIDATED',
  'RECONCILED',
  'FAILED',
  'RECONCILIATION_EXCEPTION',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

/** The agents that act on an invoice, in pipeline order. */
export const AGENT_ACTORS = [
  'intake',
  'screen',
  'extractor',
  'verifier',
  'matcher',
  'warden',
  'signer',
  'submitter',
  'reconciler',
] as const;

export type AgentActor = (typeof AGENT_ACTORS)[number];

export const STATE_LABELS: Readonly<Record<AgentState, string>> = {
  RECEIVED: 'Received',
  QUARANTINED: 'Quarantined: not read',
  EXTRACTED: 'Fields read, each with its quote',
  EVIDENCE_VERIFIED: 'Evidence checked against records',
  HELD: 'Held for a person',
  WARDEN_ELIGIBLE: 'Eligible for the Warden',
  SIGNED: 'Signed, ready to submit',
  SUBMITTED: 'Submitted, awaiting validation',
  VALIDATED: 'Validated on the ledger',
  RECONCILED: 'Paid: validated and reconciled',
  FAILED: 'Failed on the ledger',
  RECONCILIATION_EXCEPTION: 'Needs a person: reconciliation',
};

export const ACTOR_LABELS: Readonly<Record<AgentActor, string>> = {
  intake: 'Intake',
  screen: 'Screen',
  extractor: 'Extractor',
  verifier: 'Verifier',
  matcher: 'Matcher',
  warden: 'Warden',
  signer: 'Signer',
  submitter: 'Submitter',
  reconciler: 'Reconciler',
};

/** One logged state change, as the browser receives it. Evidence hashes and document-derived text are not included. */
export interface MapEventInput {
  readonly seq: number;
  readonly at: string;
  readonly correlationId: string;
  readonly fromState: AgentState | null;
  readonly toState: AgentState;
  readonly actor: AgentActor;
  readonly reasonCode: string;
  readonly policyVersion: string;
}

/**
 * The map's places: the agents, the arrival point, the hold lane, the ledger and the paid end, plus the owner's
 * phone approval for high-value payments and the simulated money-in and money-out legs.
 */
export type MapNode =
  AgentActor | 'arrival' | 'hold' | 'ledger' | 'paid' | 'approver' | 'onramp' | 'payout';

/** The look of a move: progress, submitted to the ledger (not yet paid), held, paid, or failed. */
export type Tone = 'progress' | 'submitted' | 'hold' | 'paid' | 'failed';

export interface Movement {
  readonly seq: number;
  readonly at: string;
  /** The first eight characters of the invoice's correlation id. Enough to tell invoices apart on screen. */
  readonly invoice: string;
  readonly actor: AgentActor;
  readonly node: MapNode;
  readonly toState: AgentState;
  readonly label: string;
  readonly tone: Tone;
  readonly reasonCode: string;
  readonly reason: string;
}

const SHORT_ID_LENGTH = 8;

/** Where the token goes on the map for a state change. Held and failed moves leave the main lane. */
export function nodeOf(state: AgentState, actor: AgentActor): MapNode {
  switch (state) {
    case 'HELD':
    case 'QUARANTINED':
    case 'RECONCILIATION_EXCEPTION':
      return 'hold';
    case 'SUBMITTED':
    case 'VALIDATED':
    case 'FAILED':
      return 'ledger';
    case 'RECONCILED':
      return 'paid';
    default:
      return actor;
  }
}

export function toneOf(state: AgentState): Tone {
  switch (state) {
    case 'HELD':
    case 'QUARANTINED':
      return 'hold';
    case 'FAILED':
    case 'RECONCILIATION_EXCEPTION':
      return 'failed';
    case 'SUBMITTED':
    case 'VALIDATED':
      return 'submitted';
    case 'RECONCILED':
      return 'paid';
    default:
      return 'progress';
  }
}

export function toMovement(event: MapEventInput): Movement {
  return {
    seq: event.seq,
    at: event.at,
    invoice: event.correlationId.slice(0, SHORT_ID_LENGTH),
    actor: event.actor,
    node: nodeOf(event.toState, event.actor),
    toState: event.toState,
    label: STATE_LABELS[event.toState],
    tone: toneOf(event.toState),
    reasonCode: event.reasonCode,
    reason: reasonTextOf(event.reasonCode),
  };
}

function isReasonCode(text: string): boolean {
  return text.length <= 64 && /^[A-Z][A-Z0-9_]*$/.test(text);
}

const HEX_64 = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function isState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

function isActor(value: unknown): value is AgentActor {
  return typeof value === 'string' && (AGENT_ACTORS as readonly string[]).includes(value);
}

/**
 * Checks a parsed server message before the browser uses it. Anything malformed is dropped, never displayed: the map
 * only moves for a well-formed state change.
 */
export function parseMapEvent(value: unknown): MapEventInput | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const seq = record['seq'];
  const at = record['at'];
  const correlationId = record['correlationId'];
  const fromState = record['fromState'];
  const toState = record['toState'];
  const actor = record['actor'];
  const reasonCode = record['reasonCode'];
  const policyVersion = record['policyVersion'];
  if (
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    typeof at !== 'string' ||
    !ISO_INSTANT.test(at) ||
    typeof correlationId !== 'string' ||
    !HEX_64.test(correlationId) ||
    !(fromState === null || isState(fromState)) ||
    !isState(toState) ||
    !isActor(actor) ||
    typeof reasonCode !== 'string' ||
    !isReasonCode(reasonCode) ||
    typeof policyVersion !== 'string'
  ) {
    return null;
  }
  return { seq, at, correlationId, fromState, toState, actor, reasonCode, policyVersion };
}
