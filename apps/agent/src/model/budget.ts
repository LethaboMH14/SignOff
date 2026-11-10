import type { ModelClient, ModelReply, ModelRequest } from './types.js';

/** The most model calls one invoice may use. The brief sets three, and the workflow uses at most two. */
export const MAX_MODEL_CALLS = 3;

export class BudgetExhaustedError extends Error {
  constructor(limit: number) {
    super(`the model budget of ${String(limit)} calls is used up`);
    this.name = 'BudgetExhaustedError';
  }
}

/** Counts the model calls made for one invoice. It cannot be reset, so a second invoice gets a new budget. */
export class ModelBudget {
  readonly limit: number;
  private spent = 0;

  constructor(limit: number = MAX_MODEL_CALLS) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MODEL_CALLS) {
      throw new RangeError(`the model budget must be between 1 and ${String(MAX_MODEL_CALLS)}`);
    }
    this.limit = limit;
  }

  get callsUsed(): number {
    return this.spent;
  }

  /** Counts one call before it is made. Throws when the limit is reached, so an uncounted call cannot happen. */
  spend(): void {
    if (this.spent >= this.limit) {
      throw new BudgetExhaustedError(this.limit);
    }
    this.spent += 1;
  }
}

/** Wraps a client so that every call is counted against the budget before it is sent. */
export function budgetedModel(client: ModelClient, budget: ModelBudget): ModelClient {
  return {
    label: client.label,
    async complete(request: ModelRequest): Promise<ModelReply> {
      budget.spend();
      return client.complete(request);
    },
  };
}
