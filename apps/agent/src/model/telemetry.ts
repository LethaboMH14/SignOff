import type { Attempt, AttemptSink } from './failover.js';
import { PROVIDERS } from './providers.js';

/**
 * What a live run did, one attempt at a time: outcome class, HTTP status, latency and reported tokens. It holds no
 * prompt, no reply text and no key, so it can be written to a results file. Attempts are grouped by labelled case, so
 * the cost per completed invoice includes the retries and failovers that invoice needed.
 */

export interface ClosedCase {
  readonly caseId: string;
  readonly attempts: readonly Attempt[];
}

export class CallLedger implements AttemptSink {
  private pending: Attempt[] = [];
  private closed: ClosedCase[] = [];

  record(attempt: Attempt): void {
    this.pending.push(attempt);
  }

  /** Assigns every attempt recorded since the last call to one case. The eval calls it once per case, in order. */
  closeCase(caseId: string): void {
    this.closed.push({ caseId, attempts: this.pending });
    this.pending = [];
  }

  cases(): readonly ClosedCase[] {
    return this.closed;
  }

  /** Attempts recorded but not yet assigned to a case, such as those of a run that has not closed a case. */
  unassigned(): readonly Attempt[] {
    return this.pending;
  }
}

export interface ProviderSummary {
  readonly provider: string;
  readonly attempts: number;
  readonly ok: number;
  readonly failuresByClass: ReadonlyMap<string, number>;
  readonly latencyMsMedian: number | null;
  readonly latencyMsP90: number | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number | null;
}

/** The list price of an attempt's provider, when its catalogue gave one. */
function priceOf(provider: string): { input: number; output: number } | null {
  const known = Object.values(PROVIDERS).find((candidate) => candidate.id === provider);
  return known?.listPrice ?? null;
}

/** The cost of one attempt at list price in US dollars, or null when the provider has no list price on record. */
export function costOf(attempt: Attempt): number | null {
  const price = priceOf(attempt.provider);
  if (price === null) return null;
  const input = attempt.promptTokens ?? 0;
  const output = attempt.completionTokens ?? 0;
  return (input * price.input + output * price.output) / 1_000_000;
}

/** The sum of the numbers, or null if any of them is not known. */
export function sumOf(costs: readonly (number | null)[]): number | null {
  const known = costs.filter((cost): cost is number => cost !== null);
  return known.length === costs.length ? known.reduce((total, cost) => total + cost, 0) : null;
}

function percentile(sorted: readonly number[], share: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function summariseByProvider(attempts: readonly Attempt[]): ProviderSummary[] {
  const providers = [...new Set(attempts.map((attempt) => attempt.provider))].sort();
  return providers.map((provider) => {
    const rows = attempts.filter((attempt) => attempt.provider === provider);
    const failures = new Map<string, number>();
    for (const row of rows) {
      if (row.outcome !== 'OK') {
        failures.set(row.outcome, (failures.get(row.outcome) ?? 0) + 1);
      }
    }
    const latencies = rows
      .filter((row) => row.outcome === 'OK')
      .map((row) => row.latencyMs)
      .sort((a, b) => a - b);
    const costs = rows.map(costOf);
    const priced = costs.every((cost) => cost !== null);
    return {
      provider,
      attempts: rows.length,
      ok: rows.filter((row) => row.outcome === 'OK').length,
      failuresByClass: new Map([...failures.entries()].sort(([a], [b]) => a.localeCompare(b))),
      latencyMsMedian: percentile(latencies, 0.5),
      latencyMsP90: percentile(latencies, 0.9),
      promptTokens: rows.reduce((total, row) => total + (row.promptTokens ?? 0), 0),
      completionTokens: rows.reduce((total, row) => total + (row.completionTokens ?? 0), 0),
      costUsd: priced ? sumOf(costs) : null,
    };
  });
}
