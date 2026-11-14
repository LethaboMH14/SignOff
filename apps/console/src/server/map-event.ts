import type { TransitionRecord } from '../../../agent/src/log/transition-log.js';
import type { MapEventInput } from '../model/states.js';

/**
 * The part of a logged move that the browser may see. Evidence hashes, attempt identifiers and ledger hashes stay on
 * the server, because the map does not need them.
 */
export function mapEventOf(record: TransitionRecord): MapEventInput {
  return {
    seq: record.seq,
    at: record.at,
    correlationId: record.correlationId,
    fromState: record.fromState,
    toState: record.toState,
    actor: record.actor,
    reasonCode: record.reasonCode,
    policyVersion: record.policyVersion,
  };
}
