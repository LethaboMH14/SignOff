import { summariseByProvider, sumOf, type ProviderSummary } from './telemetry.js';
import type { Attempt } from './failover.js';

/**
 * The live-run section of a results file: replies and failures by class per provider, latency, tokens, cost per
 * completed invoice (retries and failovers included), and each invoice's trail of attempts. It is plain text and holds
 * no prompt, no reply text and no key.
 */

export interface LiveCase {
  readonly id: string;
  readonly category: string;
  readonly expectedDecision: string;
  readonly decision: string;
  readonly reasonCode: string;
  readonly tokens: readonly string[];
  /** True when a schema-valid reply was read, so the invoice was extracted. */
  readonly extracted: boolean;
  readonly attempts: readonly Attempt[];
}

export interface LiveSummaryInput {
  readonly chainUsed: readonly string[];
  readonly skipped: readonly string[];
  readonly cases: readonly LiveCase[];
  readonly baselineAttempts: readonly Attempt[];
  readonly wallMs: number;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`;
}

function money(value: number | null): string {
  if (value === null) return 'not priced';
  return `$${value.toFixed(6)}`;
}

function ms(value: number | null): string {
  return value === null ? 'n/a' : `${String(Math.round(value))} ms`;
}

function failuresOf(row: ProviderSummary): string {
  const parts = [...row.failuresByClass.entries()].map(
    ([name, count]) => `${name} ${String(count)}`,
  );
  return parts.length === 0 ? 'none' : parts.join(', ');
}

export function renderLiveSummary(input: LiveSummaryInput): string {
  const attempts = input.cases.flatMap((item) => item.attempts);
  const reached = input.cases.filter((item) => item.attempts.length > 0);
  const extracted = reached.filter((item) => item.extracted);
  const summaries = summariseByProvider(attempts);
  const totalCost = sumOf(summaries.map((row) => row.costUsd));
  const perCompleted =
    extracted.length === 0 || totalCost === null ? null : totalCost / extracted.length;
  const lines: string[] = [];
  lines.push('## Live run: replies, failures and cost');
  lines.push('');
  lines.push(`- Chain tried, in order: ${input.chainUsed.join(' > ') || 'none'}`);
  lines.push(
    `- Providers skipped (no key or address set; the name only): ${input.skipped.join(', ') || 'none'}`,
  );
  lines.push(
    `- Invoices that reached a model: ${String(reached.length)} of ${String(input.cases.length)}`,
  );
  lines.push(
    `- Valid replies (invoice read from a schema-valid reply): ${String(extracted.length)} of ${String(reached.length)} = ${pct(extracted.length, reached.length)}`,
  );
  lines.push(`- Wall clock for the pipeline calls: ${ms(input.wallMs)}`);
  lines.push('');
  lines.push('### Calls by provider');
  lines.push('');
  lines.push(
    '| Provider | Attempts | OK | Failures by class | Latency median | Latency p90 | Prompt tokens | Completion tokens | Cost at list price |',
  );
  lines.push('| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summaries) {
    lines.push(
      `| ${row.provider} | ${String(row.attempts)} | ${String(row.ok)} | ${failuresOf(row)} | ${ms(row.latencyMsMedian)} | ${ms(row.latencyMsP90)} | ${String(row.promptTokens)} | ${String(row.completionTokens)} | ${money(row.costUsd)} |`,
    );
  }
  lines.push('');
  lines.push('### Cost per completed invoice');
  lines.push('');
  lines.push(`- Completed invoices (extracted): ${String(extracted.length)}`);
  lines.push(
    `- Total cost of the pipeline calls at list price, failed attempts included: ${money(totalCost)}`,
  );
  lines.push(
    `- Cost per completed invoice, retries and failovers included: ${money(perCompleted)}`,
  );
  lines.push(
    `- Attempts per invoice that reached a model: ${reached.length === 0 ? 'n/a' : (attempts.length / reached.length).toFixed(2)}`,
  );
  lines.push('');
  lines.push('### Per invoice');
  lines.push('');
  lines.push('| Case | Attempts | Outcome by attempt | Final reason | Detail |');
  lines.push('| --- | ---: | --- | --- | --- |');
  for (const item of input.cases) {
    const trail =
      item.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join(' > ') || '-';
    lines.push(
      `| ${item.id} | ${String(item.attempts.length)} | ${trail} | ${item.reasonCode} | ${item.tokens.join(', ') || '-'} |`,
    );
  }
  lines.push('');
  if (input.baselineAttempts.length > 0) {
    lines.push('### Single-prompt baseline calls (separate from the pipeline)');
    lines.push('');
    for (const row of summariseByProvider(input.baselineAttempts)) {
      lines.push(
        `- ${row.provider}: ${String(row.attempts)} attempts, ${String(row.ok)} OK, cost ${money(row.costUsd)}`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
