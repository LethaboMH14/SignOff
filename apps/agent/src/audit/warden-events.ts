import { z } from 'zod';

/**
 * Reads one line of the Warden's event log for the audit export. The Warden owns that log and its schema, so this
 * reader takes only the fields the export shows and ignores the rest. A line it cannot read is counted, never guessed.
 */

export interface WardenAuditEvent {
  readonly source: 'warden';
  readonly type:
    'decision.recorded' | 'attempt.awaiting' | 'attempt.submitting' | 'attempt.settled';
  readonly at: string;
  readonly attemptId: string;
  readonly decision: string | null;
  readonly reasonCodes: readonly string[];
  readonly policyVersion: string | null;
  readonly status: string | null;
  readonly hash: string | null;
  readonly ledgerIndex: number | null;
  readonly engineResult: string | null;
}

const RawLine = z.looseObject({
  type: z.string().min(1).max(60),
  at: z.iso.datetime(),
  attemptId: z.uuid().optional(),
  decision: z
    .looseObject({
      decision: z.string().min(1).max(20),
      policyVersion: z.string().max(40).optional(),
      reasons: z
        .array(z.looseObject({ code: z.string().min(1).max(60) }))
        .max(20)
        .optional(),
    })
    .optional(),
  status: z.string().max(40).nullable().optional(),
  hash: z.string().max(200).optional(),
  ledgerIndex: z.number().int().min(1).nullable().optional(),
  engineResult: z.string().max(40).nullable().optional(),
});

const DECISION_TYPES = new Set(['decision.recorded', 'attempt.awaiting']);
const SETTLEMENT_TYPES = new Set(['attempt.submitting', 'attempt.settled']);

/** The event as the export shows it, `null` for a line of a type the export does not show, or 'unreadable'. */
export function normaliseWardenLine(line: string): WardenAuditEvent | null | 'unreadable' {
  let json: unknown;
  try {
    json = JSON.parse(line) as unknown;
  } catch {
    return 'unreadable';
  }
  const parsed = RawLine.safeParse(json);
  if (!parsed.success) {
    return 'unreadable';
  }
  const raw = parsed.data;
  if (raw.attemptId === undefined) {
    return null;
  }
  if (DECISION_TYPES.has(raw.type) && raw.decision !== undefined && isWardenType(raw.type)) {
    return {
      source: 'warden',
      type: raw.type,
      at: raw.at,
      attemptId: raw.attemptId,
      decision: raw.decision.decision,
      reasonCodes: (raw.decision.reasons ?? []).map((reason) => reason.code),
      policyVersion: raw.decision.policyVersion ?? null,
      status: null,
      hash: null,
      ledgerIndex: null,
      engineResult: null,
    };
  }
  if (SETTLEMENT_TYPES.has(raw.type) && isWardenType(raw.type)) {
    return {
      source: 'warden',
      type: raw.type,
      at: raw.at,
      attemptId: raw.attemptId,
      decision: null,
      reasonCodes: [],
      policyVersion: null,
      status: raw.status ?? null,
      hash: raw.hash ?? null,
      ledgerIndex: raw.ledgerIndex ?? null,
      engineResult: raw.engineResult ?? null,
    };
  }
  return null;
}

const WARDEN_TYPES = new Set<string>([
  'decision.recorded',
  'attempt.awaiting',
  'attempt.submitting',
  'attempt.settled',
]);

function isWardenType(type: string): type is WardenAuditEvent['type'] {
  return WARDEN_TYPES.has(type);
}
