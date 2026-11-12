import type { ReviewerRole } from '../swarm/schemas.js';

/**
 * The route policy: a versioned table, read in order, first match wins. Inputs are facts the code already knows (scan or
 * text, new supplier, bank change, amount band, sender check, prior holds). The output names a route, the reviewers
 * that run at the start, and whether the judge may add the other reviewer later. A model never chooses a route.
 *
 * A change to this table changes ROUTE_POLICY_VERSION, which goes into every decision-log entry. The table is data, so a
 * reviewer can read it in one place; the second-approver rule for edits is an operator procedure (see the ADR).
 */

export const ROUTE_POLICY_VERSION = 'route-v1';

export interface RouteFacts {
  readonly scan: boolean;
  readonly newSupplier: boolean;
  readonly bankChanged: boolean;
  readonly amountBand: 'SMALL' | 'MEDIUM' | 'LARGE';
  readonly senderCheck: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly priorHolds: number;
}

export type Route = 'HOLD' | 'LIGHT' | 'DEEP';

export interface RouteDecision {
  readonly policyVersion: typeof ROUTE_POLICY_VERSION;
  readonly ruleId: string;
  readonly route: Route;
  /** The reviewers that run at the start, in a fixed order. */
  readonly reviewers: readonly ReviewerRole[];
  /** Whether the judge may add the reviewer that did not run (only within the initial-call budget). */
  readonly canAddReviewer: boolean;
  /** A reason code, set when the route is HOLD. */
  readonly holdCode: string | null;
}

interface Rule {
  readonly id: string;
  readonly when: (facts: RouteFacts) => boolean;
  readonly route: Route;
  readonly reviewers: readonly ReviewerRole[];
  readonly canAddReviewer: boolean;
  readonly holdCode: string | null;
}

/** The table. Order matters: the first rule whose `when` is true is the route. The last rule matches everything. */
export const ROUTE_TABLE: readonly Rule[] = [
  {
    id: 'R1-sender-not-passed',
    when: (f) => f.senderCheck !== 'PASS',
    route: 'HOLD',
    reviewers: [],
    canAddReviewer: false,
    holdCode: 'SENDER_CHECK_NOT_PASSED',
  },
  {
    id: 'R2-scan',
    when: (f) => f.scan,
    route: 'DEEP',
    reviewers: ['procurement', 'fraud'],
    canAddReviewer: false,
    holdCode: null,
  },
  {
    id: 'R3-new-supplier-or-bank-change',
    when: (f) => f.newSupplier || f.bankChanged,
    route: 'DEEP',
    reviewers: ['procurement', 'fraud'],
    canAddReviewer: false,
    holdCode: null,
  },
  {
    id: 'R4-large-amount',
    when: (f) => f.amountBand === 'LARGE',
    route: 'DEEP',
    reviewers: ['procurement', 'fraud'],
    canAddReviewer: false,
    holdCode: null,
  },
  {
    id: 'R5-prior-holds',
    when: (f) => f.priorHolds > 0,
    route: 'DEEP',
    reviewers: ['procurement', 'fraud'],
    canAddReviewer: false,
    holdCode: null,
  },
  {
    id: 'R6-default-light',
    when: () => true,
    route: 'LIGHT',
    reviewers: ['procurement'],
    canAddReviewer: true,
    holdCode: null,
  },
];

export function decideRoute(
  facts: RouteFacts,
  table: readonly Rule[] = ROUTE_TABLE,
): RouteDecision {
  const rule = table.find((candidate) => candidate.when(facts));
  if (rule === undefined) {
    throw new Error('the route table has no matching rule; the invoice is not routed');
  }
  return {
    policyVersion: ROUTE_POLICY_VERSION,
    ruleId: rule.id,
    route: rule.route,
    reviewers: rule.reviewers,
    canAddReviewer: rule.canAddReviewer,
    holdCode: rule.holdCode,
  };
}
