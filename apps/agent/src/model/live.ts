import { createChatClient } from './chat-client.js';
import { failoverModel, type AttemptSink, type CallCaps, type Hop } from './failover.js';
import { FAILOVER_ORDER, baseUrlOf, providerById, type ProviderId } from './providers.js';
import type { ModelClient } from './types.js';

/**
 * Builds the live model chain from the environment. A provider is in the chain only when its key is set (and, for
 * Meta, its address), so an unconfigured provider is skipped by name, never guessed at. The key and the address are
 * read here and held in memory for the run. Their values are never logged. A chain with no provider stops the run.
 */

export interface LiveChainOptions {
  /** The providers to try, in order. Defaults to the full failover order. */
  readonly providerIds?: readonly ProviderId[];
  /** Overrides the model of a provider, for one run. Only meaningful for a single-provider chain. */
  readonly model?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly sink?: AttemptSink;
  readonly caps?: CallCaps;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface SkippedProvider {
  readonly provider: ProviderId;
  /** A fixed reason, never a value. */
  readonly reason: 'NO_KEY' | 'NO_ADDRESS';
}

export interface LiveChain {
  readonly client: ModelClient;
  readonly used: readonly string[];
  readonly skipped: readonly SkippedProvider[];
}

export function buildLiveChain(options: LiveChainOptions): LiveChain {
  const order = options.providerIds ?? FAILOVER_ORDER;
  const hops: Hop[] = [];
  const skipped: SkippedProvider[] = [];
  for (const id of order) {
    const provider = providerById(id);
    const key = options.env[provider.keyEnv];
    if (key === undefined || key.trim().length === 0) {
      skipped.push({ provider: id, reason: 'NO_KEY' });
      continue;
    }
    let baseUrl: string;
    try {
      baseUrl = baseUrlOf(provider, options.env);
    } catch {
      skipped.push({ provider: id, reason: 'NO_ADDRESS' });
      continue;
    }
    const model = options.model ?? provider.defaultModel;
    const client = createChatClient({
      provider,
      model,
      baseUrl,
      apiKey: key.trim(),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    hops.push({ provider: provider.id, model, client, price: provider.listPrice });
  }
  if (hops.length === 0) {
    throw new RangeError(
      `no provider is configured: set one of ${order.map((id) => providerById(id).keyEnv).join(', ')}`,
    );
  }
  const client = failoverModel({
    hops,
    ...(options.sink === undefined ? {} : { sink: options.sink }),
    ...(options.caps === undefined ? {} : { caps: options.caps }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.random === undefined ? {} : { random: options.random }),
    ...(options.baseDelayMs === undefined ? {} : { baseDelayMs: options.baseDelayMs }),
    ...(options.maxDelayMs === undefined ? {} : { maxDelayMs: options.maxDelayMs }),
  });
  return { client, used: hops.map((hop) => `${hop.provider}:${hop.model}`), skipped };
}
