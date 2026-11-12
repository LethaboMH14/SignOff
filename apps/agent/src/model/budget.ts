import {
  ModelError,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
  type SpendTracker,
} from './types.js';

/** The most model calls one invoice may use. The brief sets three, and the workflow uses at most two. */
export const MAX_MODEL_CALLS = 3;

export class BudgetExhaustedError extends Error {
  constructor(limit: number) {
    super(`the model budget of ${String(limit)} calls is used up`);
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * The most dollars one invoice may spend on model calls, at list price. A reservation past it is refused. The worst case
 * for one invoice is MAX_MODEL_CALLS calls of up to four attempts each, so this default bounds a single invoice's cost.
 */
export const DEFAULT_INVOICE_USD = 0.05;

/**
 * Counts the model calls made for one invoice, and the dollars they may spend. It cannot be reset, so a second invoice
 * gets a new budget. It is the invoice's spend tracker: each attempt reserves against it before it is sent.
 */
export class ModelBudget implements SpendTracker {
  readonly limit: number;
  readonly usdLimit: number;
  private spent = 0;
  private usdSpent = 0;

  constructor(limit: number = MAX_MODEL_CALLS, usdLimit: number = DEFAULT_INVOICE_USD) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MODEL_CALLS) {
      throw new RangeError(`the model budget must be between 1 and ${String(MAX_MODEL_CALLS)}`);
    }
    if (!Number.isFinite(usdLimit) || usdLimit <= 0) {
      throw new RangeError('the invoice dollar limit must be a positive number');
    }
    this.limit = limit;
    this.usdLimit = usdLimit;
  }

  get callsUsed(): number {
    return this.spent;
  }

  get usdReserved(): number {
    return this.usdSpent;
  }

  /** Reserves the worst case of one attempt. Throws a SPEND_CAP error, and sends nothing, when it would pass the limit. */
  reserveUsd(estimateUsd: number): void {
    if (this.usdSpent + estimateUsd > this.usdLimit) {
      throw new ModelError('SPEND_CAP', 'the dollar limit for this invoice would be exceeded');
    }
    this.usdSpent += estimateUsd;
  }

  /** Replaces a reservation with the attempt's actual cost. */
  settleUsd(estimateUsd: number, actualUsd: number): void {
    this.usdSpent = Math.max(0, this.usdSpent - estimateUsd + Math.max(0, actualUsd));
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
