/**
 * The agent's states and actors, and the plain-language text the console shows for them. This module has no Node
 * imports, so the browser can use it. A test keeps its lists equal to the agent's own lists.
 */

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

/**
 * Plain-language text for each logged reason code. Every entry is fixed text written once and reviewed; nothing is
 * generated per invoice. A code without an entry is shown as its code, never as an invented sentence.
 */
const REASON_TEXT: ReadonlyMap<string, string> = new Map<string, string>([
  ['OK', 'No problem found at this step.'],
  ['PAYEE_CHANGED', 'The account on the invoice is not the account this supplier enrolled.'],
  ['PAYEE_CHANGE_CLAIM', 'The invoice says the bank details have changed.'],
  ['PAYEE_NOT_VERIFIED', 'The payee has not been verified.'],
  ['MISSING_EVIDENCE', 'A record needed to check the invoice is missing.'],
  ['AMOUNT_MISMATCH', 'The amount does not match the record it is checked against.'],
  ['DUPLICATE', 'This invoice or payable already has a payment in progress or settled.'],
  ['OVER_LIMIT', 'This payment would go over a limit set by the operator.'],
  ['PAUSED', 'New payments are paused by the operator.'],
  ['ACCOUNT_FROZEN', 'The asset or an account is frozen on the ledger.'],
  ['LEDGER_UNREADABLE', 'The ledger could not be read, so nothing was signed.'],
  ['INVARIANT_FAILED', 'A safety check failed, so the payment was stopped.'],
  ['UNSUPPORTED_TRANSACTION', 'This kind of payment is not allowed.'],
  ['SUPPLIER_NOT_APPROVED', 'The supplier is not approved yet.'],
  ['SIGNER_CHANGE_NOT_APPROVED', 'A change to the signing setup needs two approvals.'],
  ['VERIFICATION_FAILED', 'A field could not be checked against its quote.'],
  ['FIELD_NOT_STATED', 'A field is not stated in the invoice text.'],
  ['MODEL_CALL_FAILED', 'The model did not return a usable reply, so the invoice is held.'],
  [
    'INSTRUCTION_LIKE_TEXT',
    'The invoice text contains instruction-like wording, which is treated as data.',
  ],
  ['MARKUP_IN_TEXT', 'The invoice text contains markup, which is treated as data.'],
  ['MATCH_FAILED', 'The invoice could not be matched to one purchase order and receipt.'],
  ['PO_NOT_FOUND', 'No purchase order matches the invoice.'],
  ['PO_MISMATCH', 'The purchase order does not agree with the invoice.'],
  ['PO_SUPPLIER_MISMATCH', 'The purchase order belongs to a different supplier.'],
  ['PO_CURRENCY_MISMATCH', 'The purchase order is in a different currency from the invoice.'],
  ['NO_GOODS_RECEIPT', 'No goods receipt is recorded for the purchase order.'],
  ['NO_INVOICE_RECORD', 'The invoice is not in the records the agent checks against.'],
  ['AMOUNT_MISMATCH', 'The amount does not match the record it is checked against.'],
  ['AMOUNT_EXCEEDS_ORDER', 'The invoice is for more than the order.'],
  ['AMOUNT_EXCEEDS_RECEIPT', 'The invoice is for more than was received.'],
  ['AMOUNT_NOT_PAYABLE', 'The amount is not a payable amount.'],
  ['AMOUNT_FORMAT', 'The amount is written in a layout the agent cannot read with certainty.'],
  ['CURRENCY_MISMATCH', 'The currency does not match the record it is checked against.'],
  ['CURRENCY_NOT_STATED', 'The invoice does not state its currency.'],
  ['DATE_FORMAT', 'The date is written in a layout the agent cannot read with certainty.'],
  ['DUPLICATE_PAYMENT', 'A payment for this invoice already exists.'],
  ['INVOICE_NUMBER_MISMATCH', 'The invoice number does not match the record.'],
  ['SUPPLIER_AMBIGUOUS', 'The supplier cannot be identified with certainty.'],
  ['PAYEE_NOT_ENROLLED', 'The payee is not the enrolled account.'],
  ['QUOTE_NOT_FOUND', 'A value the agent read has no matching quote in the invoice text.'],
  ['QUOTE_AMBIGUOUS', 'A value the agent read matches more than one place in the invoice text.'],
  ['PDF_UNREADABLE', 'The PDF could not be read.'],
  ['PDF_ENCRYPTED', 'The PDF is encrypted, so it cannot be read.'],
  ['NO_TEXT_LAYER', 'The PDF has no text layer, so it cannot be read.'],
  ['SCREEN_FLAGGED', 'The screen flagged the invoice text for a person to check.'],
  ['MODEL_OUTPUT_INVALID', 'The model reply did not match the required form, so it is not used.'],
  ['PROPOSAL_INVALID', 'The payment proposal did not match its schema.'],
  ['SIGNING_FAILED', 'The signature could not be made, so nothing was sent.'],
  ['OUTCOME_UNKNOWN', 'The outcome is not known yet, so the invoice is not treated as paid.'],
]);

export function reasonTextOf(code: string): string {
  return REASON_TEXT.get(code) ?? `Reason code ${code}: no plain text yet.`;
}

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

/** The map's places: the agents, the arrival point, the hold lane, the ledger and the paid end. */
export type MapNode = AgentActor | 'arrival' | 'hold' | 'ledger' | 'paid';

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
