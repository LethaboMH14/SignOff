import { reasonTextOf } from './reasons.js';
import { type AgentState } from './states.js';

/**
 * The payment desk's rules. This module has no Node imports, so the browser can use it. The server builds the rows
 * from the Warden's read views and the agent's transition log; the rules below decide what each row says.
 */

/** The attempt statuses the Warden reports. A proposal with no attempt is shown as held or refused (see rowOf). */
export const WARDEN_STATUSES = [
  'awaiting',
  'submitting',
  'held',
  'paid',
  'failed',
  'rejected',
  'expired',
] as const;

export type WardenStatus = (typeof WARDEN_STATUSES)[number];

/** What the desk says about one invoice. Every state has words; the symbol is decoration only. */
export const DISPLAY_STATES = [
  'Paid',
  'In progress',
  'Held',
  'Refused',
  'Not paid',
  'Failed',
  'Needs a person',
  'Not confirmed',
  'Quarantined',
  'Received',
] as const;

export type DisplayState = (typeof DISPLAY_STATES)[number];

export interface DisplayInput {
  /** The agent's latest state for the invoice, or null when the agent has no record of it. */
  readonly agentState: AgentState | null;
  /** The Warden's attempt status, or null when there is no attempt (a hold or refusal, or nothing proposed yet). */
  readonly wardenStatus: WardenStatus | null;
  /** True only when the Warden's ledger result is a validated success that names a ledger index. */
  readonly ledgerValidated: boolean;
}

/**
 * The one display state for an invoice. "Paid" appears only when all three hold: the Warden attempt is paid, the ledger
 * result is validated, and the agent has recorded reconciliation (its state is RECONCILED). Any other combination with a
 * paid attempt is "Not confirmed", so the desk never says paid early.
 */
export function displayStateOf(input: DisplayInput): DisplayState {
  const reconciled = input.agentState === 'RECONCILED';
  if (input.wardenStatus === 'paid') {
    return input.ledgerValidated && reconciled ? 'Paid' : 'Not confirmed';
  }
  if (input.agentState === 'QUARANTINED') {
    return 'Quarantined';
  }
  if (input.agentState === 'RECONCILIATION_EXCEPTION') {
    return 'Needs a person';
  }
  if (input.wardenStatus === 'failed' || input.agentState === 'FAILED') {
    return 'Failed';
  }
  if (reconciled) {
    // The agent recorded reconciliation but the Warden does not show a paid attempt: a conflict, never shown as paid.
    return 'Not confirmed';
  }
  if (input.wardenStatus === 'held' || input.agentState === 'HELD') {
    return 'Held';
  }
  if (input.wardenStatus === 'rejected') {
    return 'Refused';
  }
  if (input.wardenStatus === 'expired') {
    return 'Not paid';
  }
  if (input.wardenStatus === 'awaiting' || input.wardenStatus === 'submitting') {
    return 'In progress';
  }
  if (
    input.agentState === 'WARDEN_ELIGIBLE' ||
    input.agentState === 'SIGNED' ||
    input.agentState === 'SUBMITTED' ||
    input.agentState === 'VALIDATED'
  ) {
    return 'In progress';
  }
  return 'Received';
}

/** The latest logged state of one invoice, reduced from the agent's transition log. */
export interface InvoiceRecord {
  readonly correlationId: string;
  readonly attemptId: string | null;
  readonly agentState: AgentState;
  readonly reasonCode: string;
  readonly at: string;
  /** The model calls the agent made for this invoice, from its evidence record (at most three). */
  readonly modelCalls: number;
}

/** One Warden decision, as the Warden's read view gives it. Only the fields the desk shows are kept. */
export interface ProposalRecord {
  readonly attemptId: string;
  readonly decision: 'ALLOW' | 'HOLD' | 'REFUSE';
  readonly reasonCodes: readonly string[];
  readonly evaluatedAt: string;
  readonly payment: {
    readonly status: WardenStatus;
    readonly supplierId: string;
    readonly currency: string;
    readonly amountMinor: number;
    readonly ledgerIndex: number | null;
    readonly engineResult: string | null;
  } | null;
}

/** One row of the desk. It holds no signed material, no transaction fields and no full account identifier. */
export interface DeskRow {
  readonly rowId: string;
  readonly invoiceRef: string;
  readonly attemptId: string | null;
  readonly supplierId: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly displayState: DisplayState;
  readonly reasonCode: string | null;
  readonly reason: string;
  /** The agent's model calls for the invoice, or null when the agent has no record of it. */
  readonly modelCalls: number | null;
  readonly updatedAt: string;
}

/** The first eight characters of an invoice's correlation id: enough to tell invoices apart on screen. */
export const INVOICE_REF_LENGTH = 8;

/** The engine result the ledger returns for a payment that validated as a success. */
const VALIDATED_RESULT = 'tesSUCCESS';

function wardenStatusOf(proposal: ProposalRecord | undefined): WardenStatus | null {
  if (proposal === undefined) {
    return null;
  }
  if (proposal.payment !== null) {
    return proposal.payment.status;
  }
  if (proposal.decision === 'HOLD') {
    return 'held';
  }
  if (proposal.decision === 'REFUSE') {
    return 'rejected';
  }
  return null;
}

function reasonCodeOf(
  invoice: InvoiceRecord | undefined,
  proposal: ProposalRecord | undefined,
): string | null {
  const warden = proposal?.reasonCodes[0];
  if (warden !== undefined) {
    return warden;
  }
  return invoice?.reasonCode ?? null;
}

function rowOf(invoice: InvoiceRecord | undefined, proposal: ProposalRecord | undefined): DeskRow {
  const payment = proposal?.payment ?? null;
  const displayState = displayStateOf({
    agentState: invoice?.agentState ?? null,
    wardenStatus: wardenStatusOf(proposal),
    ledgerValidated:
      payment !== null && payment.engineResult === VALIDATED_RESULT && payment.ledgerIndex !== null,
  });
  const reasonCode = reasonCodeOf(invoice, proposal);
  const correlationId = invoice?.correlationId ?? '';
  const updatedAt = [invoice?.at ?? '', proposal?.evaluatedAt ?? ''].sort().at(-1) ?? '';
  return {
    rowId: proposal?.attemptId ?? correlationId,
    invoiceRef: correlationId.slice(0, INVOICE_REF_LENGTH),
    attemptId: proposal?.attemptId ?? null,
    supplierId: payment?.supplierId ?? null,
    amountMinor: payment?.amountMinor ?? null,
    currency: payment?.currency ?? null,
    displayState,
    reasonCode,
    reason: reasonCode === null ? 'No reason code is recorded.' : reasonTextOf(reasonCode),
    modelCalls: invoice?.modelCalls ?? null,
    updatedAt,
  };
}

/**
 * The desk's rows: one per Warden decision, joined to the agent's record of the same attempt, plus one per invoice the
 * agent holds that the Warden has not decided. Newest first.
 */
export function deskRowsOf(
  invoices: readonly InvoiceRecord[],
  proposals: readonly ProposalRecord[],
): DeskRow[] {
  const byAttempt = new Map<string, InvoiceRecord>();
  for (const invoice of invoices) {
    if (invoice.attemptId !== null) {
      byAttempt.set(invoice.attemptId, invoice);
    }
  }
  const linked = new Set<string>();
  const rows: DeskRow[] = [];
  for (const proposal of proposals) {
    const invoice = byAttempt.get(proposal.attemptId);
    if (invoice !== undefined) {
      linked.add(invoice.correlationId);
    }
    rows.push(rowOf(invoice, proposal));
  }
  for (const invoice of invoices) {
    if (!linked.has(invoice.correlationId)) {
      rows.push(rowOf(invoice, undefined));
    }
  }
  return rows.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.rowId.localeCompare(b.rowId),
  );
}

/** Counts of each display state, for the tiles and the state mix. Every state is present, even at zero. */
export function countsOf(rows: readonly DeskRow[]): Readonly<Record<DisplayState, number>> {
  const counts = Object.fromEntries(DISPLAY_STATES.map((state) => [state, 0])) as Record<
    DisplayState,
    number
  >;
  for (const row of rows) {
    counts[row.displayState] += 1;
  }
  return counts;
}
