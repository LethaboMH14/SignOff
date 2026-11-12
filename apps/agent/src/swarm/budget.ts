/**
 * The swarm's call budget, enforced in code. One invoice gets three initial calls (one per agent: extractor, procurement
 * reviewer, fraud reviewer) and at most one repair call, shared by all agents. A fourth call of either kind cannot be
 * made: spend throws before the request is sent.
 *
 * The state is persisted through onSpend before each call, so a run that is killed and resumed cannot spend more than
 * the budget across both runs (see graph/checkpoint.ts).
 */

export const INITIAL_CALLS = 3;
export const REPAIR_CALLS = 1;

export interface BudgetSnapshot {
  readonly initial: number;
  readonly repair: number;
}

export class BudgetError extends Error {
  constructor(kind: 'initial' | 'repair') {
    super(`the ${kind} model-call budget is used up for this invoice`);
    this.name = 'BudgetError';
  }
}

export class SwarmBudget {
  private initial: number;
  private repair: number;
  private readonly onSpend: ((snapshot: BudgetSnapshot) => void) | undefined;

  constructor(
    snapshot: BudgetSnapshot = { initial: 0, repair: 0 },
    onSpend?: (snapshot: BudgetSnapshot) => void,
  ) {
    if (
      !Number.isInteger(snapshot.initial) ||
      !Number.isInteger(snapshot.repair) ||
      snapshot.initial < 0 ||
      snapshot.initial > INITIAL_CALLS ||
      snapshot.repair < 0 ||
      snapshot.repair > REPAIR_CALLS
    ) {
      throw new RangeError('the budget snapshot is outside the swarm limits');
    }
    this.initial = snapshot.initial;
    this.repair = snapshot.repair;
    this.onSpend = onSpend;
  }

  snapshot(): BudgetSnapshot {
    return { initial: this.initial, repair: this.repair };
  }

  get remainingInitial(): number {
    return INITIAL_CALLS - this.initial;
  }

  get remainingRepair(): number {
    return REPAIR_CALLS - this.repair;
  }

  /** Counts one call before it is made. The count is persisted (onSpend) before the caller may send the request. */
  spend(kind: 'initial' | 'repair'): void {
    if (kind === 'initial') {
      if (this.initial >= INITIAL_CALLS) {
        throw new BudgetError('initial');
      }
      this.initial += 1;
    } else {
      if (this.repair >= REPAIR_CALLS) {
        throw new BudgetError('repair');
      }
      this.repair += 1;
    }
    this.onSpend?.(this.snapshot());
  }
}
