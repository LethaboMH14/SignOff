import type { TransitionRecord } from '../log/transition-log.js';

import { normaliseWardenLine, type WardenAuditEvent } from './warden-events.js';

/**
 * The audit export for one payment (or one invoice file). It joins what the agent decided with what the Warden
 * recorded for the same attempts, in order, with the reason, the actor, the policy version and the evidence hashes
 * for every move. The export holds hashes of quotes and records, never their text, so it can be shared without
 * putting document content or personal data into it.
 */

export const AUDIT_NOTICE =
  'Agent decision log joined with the Warden event log for the same attempts. Quotes and records appear only as SHA-256 hashes.';

export interface AuditSelector {
  readonly obligationKey: string | null;
  readonly correlationId: string | null;
}

export interface AuditExport {
  readonly schemaVersion: 1;
  readonly notice: string;
  readonly generatedAt: string;
  readonly selector: AuditSelector;
  readonly agentTransitions: readonly TransitionRecord[];
  readonly wardenEvents: readonly WardenAuditEvent[];
  /** Warden log lines that could not be read. A non-zero count means the export is incomplete. */
  readonly unreadableWardenLines: number;
}

/**
 * The agent records for one payment: by obligation when there is one, otherwise by the invoice file. An obligation is
 * only known after matching, so the moves before it (received, extracted, verified) carry no key. They are included
 * when the same invoice file later reaches that obligation, so the export shows the whole path.
 */
export function selectRecords(
  records: readonly TransitionRecord[],
  selector: AuditSelector,
): TransitionRecord[] {
  if (selector.obligationKey === null && selector.correlationId === null) {
    throw new RangeError('an audit export needs an obligation key or an invoice identifier');
  }
  if (selector.obligationKey === null) {
    return records.filter((record) => record.correlationId === selector.correlationId);
  }
  const obligationKey = selector.obligationKey;
  const invoices = new Set(
    records
      .filter((record) => record.obligationKey === obligationKey)
      .map((record) => record.correlationId),
  );
  return records.filter((record) => invoices.has(record.correlationId));
}

export function buildAuditExport(input: {
  readonly records: readonly TransitionRecord[];
  readonly selector: AuditSelector;
  readonly wardenLines: readonly string[];
  readonly now: Date;
}): AuditExport {
  const agentTransitions = selectRecords(input.records, input.selector);
  const attemptIds = new Set<string>();
  for (const record of agentTransitions) {
    if (record.attemptId !== null) {
      attemptIds.add(record.attemptId);
    }
  }

  let unreadable = 0;
  const wardenEvents: WardenAuditEvent[] = [];
  for (const line of input.wardenLines) {
    if (line.trim().length === 0) {
      continue;
    }
    const normalised = normaliseWardenLine(line);
    if (normalised === 'unreadable') {
      unreadable += 1;
    } else if (normalised !== null && attemptIds.has(normalised.attemptId)) {
      wardenEvents.push(normalised);
    }
  }
  wardenEvents.sort(
    (left, right) => left.at.localeCompare(right.at) || left.type.localeCompare(right.type),
  );

  return {
    schemaVersion: 1,
    notice: AUDIT_NOTICE,
    generatedAt: input.now.toISOString(),
    selector: input.selector,
    agentTransitions,
    wardenEvents,
    unreadableWardenLines: unreadable,
  };
}

const CSV_HEADER = [
  'source',
  'seq',
  'at',
  'type',
  'correlation_id',
  'obligation_key',
  'from_state',
  'to_state',
  'actor',
  'reason_code',
  'reasons',
  'policy_version',
  'attempt_id',
  'decision',
  'status',
  'ledger_hash',
  'file_sha256',
  'record_sha256s',
  'quote_sha256s',
  'model',
  'model_calls',
  'screen_codes',
] as const;

/**
 * One CSV cell. A text cell that starts like a formula is prefixed with an apostrophe, so a spreadsheet shows it as
 * text and does not run it. Cells with a comma, quote or line break are quoted, with quotes doubled.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function auditToCsv(exported: AuditExport): string {
  const rows: string[] = [CSV_HEADER.join(',')];
  for (const record of exported.agentTransitions) {
    rows.push(
      [
        'agent',
        String(record.seq),
        record.at,
        'transition',
        record.correlationId,
        record.obligationKey ?? '',
        record.fromState ?? '',
        record.toState,
        record.actor,
        record.reasonCode,
        record.reasons.join(';'),
        record.policyVersion,
        record.attemptId ?? '',
        '',
        '',
        record.ledgerHash ?? '',
        record.evidence.fileSha256 ?? '',
        record.evidence.recordSha256s.join(';'),
        record.evidence.quoteSha256s.join(';'),
        record.evidence.model ?? '',
        String(record.evidence.modelCalls),
        record.evidence.screenCodes.join(';'),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  for (const event of exported.wardenEvents) {
    rows.push(
      [
        'warden',
        '',
        event.at,
        event.type,
        '',
        '',
        '',
        '',
        'warden',
        '',
        event.reasonCodes.join(';'),
        event.policyVersion ?? '',
        event.attemptId,
        event.decision ?? '',
        event.status ?? '',
        event.hash ?? '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}
