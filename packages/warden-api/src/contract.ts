import type { WardenDecision } from '../../shared/src/schemas/index.js';

/**
 * The wire contract between the Warden and its callers. The Warden returns these shapes and the callers read them,
 * so both sides import the types from here rather than keeping their own copies.
 */

/** How an attempt ended on the ledger, as the Warden reports it. */
export type Outcome = 'paid' | 'failed' | 'rejected' | 'expired' | 'held' | 'pending';

export interface ProposeResult {
  /** Null only when the proposal did not parse, so there is no attempt to name. */
  readonly attemptId: string | null;
  readonly decision: WardenDecision;
  /** Unsigned Warden-prepared transaction; Warden's signature is NEVER sent before final authorization. */
  readonly toCoSign: string | null;
}

export interface CoSignResult {
  readonly attemptId: string;
  readonly outcome: Outcome;
  readonly hash: string;
  readonly ledgerIndex: number | null;
  readonly engineResult: string | null;
}

/** The Warden's health answer. It reports pause state, the policy version in force, the Warden's version and readiness. */
export interface HealthResult {
  readonly paused: boolean;
  readonly policyVersion: string;
  readonly version: string;
  readonly ready: boolean;
}
