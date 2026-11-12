import type { RoleContext } from '../context/types.js';
import type { ReviewOutcome } from '../swarm/reviewers.js';
import type { ReviewerRole } from '../swarm/schemas.js';

import type { RouteDecision } from './route-policy.js';
import { unverifiedQuotes } from './quotes.js';

/**
 * The orchestrator-judge. It reads what the agents returned and chooses one of four actions. It is a pure function of
 * its input, so the same input always gives the same action (doctrine 5), and it has no field for model confidence.
 *
 *   ACCEPT         every reviewer in the route returned a valid PASS, with verified quotes and no code-side disagreement.
 *   REPAIR         one agent gets one repair call (only while the repair slot is unused).
 *   ADD_REVIEWER   the reviewer the route did not start is run, when a reviewer abstains and the initial budget allows.
 *   HOLD           stop, with a reason code. A model cannot override a HOLD, and a HOLD never pays.
 *
 * Every action maps to an edge that exists in the graph (graph/edges.ts). The judge never names a payment step.
 */

export const JUDGE_POLICY_VERSION = 'judge-v1';

/** A whole invoice must finish within this many milliseconds of model time, or it is held. */
export const JUDGE_LATENCY_LIMIT_MS = 120_000;

export type JudgeAction =
  | { readonly kind: 'ACCEPT' }
  | { readonly kind: 'REPAIR'; readonly role: ReviewerRole; readonly issues: readonly string[] }
  | { readonly kind: 'ADD_REVIEWER'; readonly role: ReviewerRole }
  | { readonly kind: 'HOLD'; readonly reasonCode: string; readonly role: ReviewerRole | null };

export interface JudgeInput {
  readonly route: RouteDecision;
  readonly extractionOk: boolean;
  readonly extractionReason: string | null;
  /** The latest outcome for each reviewer that has run. */
  readonly outcomes: readonly ReviewOutcome[];
  /** The context each reviewer was given, used to check its quotes. */
  readonly contexts: Readonly<Partial<Record<ReviewerRole, RoleContext>>>;
  /** Checks done by code, not by a model. Null means the check could not be made, and it is not treated as a pass. */
  readonly codeChecks: { readonly poAmountWithinTolerance: boolean | null };
  readonly budget: { readonly remainingInitial: number; readonly remainingRepair: number };
  readonly elapsedMs: number;
  readonly latencyLimitMs?: number;
}

const ROLE_PREFIX: Readonly<Record<ReviewerRole, string>> = {
  procurement: 'PROCUREMENT',
  fraud: 'FRAUD',
};

export function judge(input: JudgeInput): JudgeAction {
  if (!input.extractionOk) {
    return { kind: 'HOLD', reasonCode: input.extractionReason ?? 'EXTRACTION_FAILED', role: null };
  }
  if (input.route.route === 'HOLD') {
    return { kind: 'HOLD', reasonCode: input.route.holdCode ?? 'ROUTE_HOLD', role: null };
  }
  if (input.elapsedMs > (input.latencyLimitMs ?? JUDGE_LATENCY_LIMIT_MS)) {
    return { kind: 'HOLD', reasonCode: 'JUDGE_LATENCY_EXCEEDED', role: null };
  }

  const byRole = new Map<ReviewerRole, ReviewOutcome>(
    input.outcomes.map((o) => [o.role, o] as const),
  );
  const repairOrHold = (
    role: ReviewerRole,
    issues: readonly string[],
    code: string,
  ): JudgeAction =>
    input.budget.remainingRepair > 0
      ? { kind: 'REPAIR', role, issues }
      : { kind: 'HOLD', reasonCode: code, role };

  // 1. Each reviewer the route started: call succeeded, schema valid, quotes verified, verdict and reason agree.
  for (const role of [...input.route.reviewers].sort()) {
    const outcome = byRole.get(role);
    if (outcome === undefined) {
      return { kind: 'HOLD', reasonCode: 'JUDGE_MISSING_REVIEW', role };
    }
    if (outcome.status === 'failed') {
      return { kind: 'HOLD', reasonCode: 'JUDGE_CALL_FAILED', role };
    }
    if (outcome.status === 'invalid' || outcome.reply === null) {
      return repairOrHold(role, outcome.issues, 'JUDGE_SCHEMA_INVALID');
    }
    // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
    const context = input.contexts[role];
    const problems =
      context === undefined ? ['evidence: no_context'] : unverifiedQuotes(outcome.reply, context);
    if (problems.length > 0) {
      return repairOrHold(role, problems, 'JUDGE_QUOTE_UNVERIFIED');
    }
    const agrees =
      outcome.reply.verdict === 'PASS'
        ? outcome.reply.reasonCode === 'NONE'
        : outcome.reply.reasonCode !== 'NONE';
    if (!agrees) {
      return repairOrHold(role, ['verdict: reason_mismatch'], 'JUDGE_INCONSISTENT_REPLY');
    }
  }

  // 2. Cross-check. A procurement PASS that code says is outside the PO tolerance is a disagreement. A PASS that code
  // could not check at all is not accepted either: an unreadable PO fails closed.
  const procurement = byRole.get('procurement');
  if (procurement?.reply?.verdict === 'PASS') {
    if (input.codeChecks.poAmountWithinTolerance === false) {
      return { kind: 'HOLD', reasonCode: 'JUDGE_REVIEWERS_DISAGREE', role: 'procurement' };
    }
    if (input.codeChecks.poAmountWithinTolerance === null) {
      return { kind: 'HOLD', reasonCode: 'JUDGE_CODE_CHECK_MISSING', role: 'procurement' };
    }
  }

  // 3. Verdicts. A HOLD from a valid reply is final. An ABSTAIN may bring in the other reviewer, if the budget allows.
  for (const outcome of [...input.outcomes].sort((a, b) => (a.role < b.role ? -1 : 1))) {
    if (outcome.reply?.verdict === 'HOLD') {
      return {
        kind: 'HOLD',
        reasonCode: `${ROLE_PREFIX[outcome.role]}_${outcome.reply.reasonCode}`,
        role: outcome.role,
      };
    }
  }
  for (const outcome of [...input.outcomes].sort((a, b) => (a.role < b.role ? -1 : 1))) {
    if (outcome.reply?.verdict === 'ABSTAIN') {
      const other = otherReviewer(outcome.role);
      const otherRan = byRole.has(other);
      if (input.route.canAddReviewer && !otherRan && input.budget.remainingInitial > 0) {
        return { kind: 'ADD_REVIEWER', role: other };
      }
      return {
        kind: 'HOLD',
        reasonCode: `${ROLE_PREFIX[outcome.role]}_INSUFFICIENT_CONTEXT`,
        role: outcome.role,
      };
    }
  }
  const allPass = input.route.reviewers.every(
    (role) => byRole.get(role)?.reply?.verdict === 'PASS',
  );
  if (allPass) {
    return { kind: 'ACCEPT' };
  }
  return { kind: 'HOLD', reasonCode: 'JUDGE_UNRESOLVED', role: null };
}

function otherReviewer(role: ReviewerRole): ReviewerRole {
  return role === 'procurement' ? 'fraud' : 'procurement';
}
