import {
  ModelError,
  RETRYABLE_CLASSES,
  type ErrorClass,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
} from './types.js';

/**
 * Provider failover. A call tries the providers in the configured order. Each provider gets at most two attempts (one
 * retry), and only for a transport class that a retry can clear (RATE_LIMIT, SERVER, TIMEOUT, NETWORK). A Retry-After
 * the provider sends is honoured; when it is longer than the backoff ceiling the retry is not made and the chain moves
 * on. Other classes move straight to the next provider, because a repeat would give the same answer. A reply that fails
 * the schema is not a failover case: extract.ts decides that, with its own repair call.
 *
 * Spend. Before each attempt the worst case that attempt could cost is reserved, first against the invoice (the request's
 * spend tracker) and then against the day (the daily caps). The reservation is then settled to the actual cost. A
 * provider with no list price on record is not used once a dollar cap applies, because its cost could not be bounded.
 *
 * Every attempt is reported to a sink, so the run can show what each provider did. The per-invoice call budget is applied
 * by the caller around the whole chain (budget.ts), so one invoice cannot use more logical calls than its budget.
 */

/** A list price in US dollars per million tokens. */
export interface Price {
  readonly input: number;
  readonly output: number;
}

export interface Hop {
  readonly provider: string;
  readonly model: string;
  readonly client: ModelClient;
  /** The list price of the hop, or null when none is on record. */
  readonly price: Price | null;
  /** The reply limit this provider needs, when it differs from the caller's (a reasoning model needs more). */
  readonly maxTokens?: number;
}

/** One HTTP attempt, as the telemetry records it. It carries no prompt, no reply text and no key. */
export interface Attempt {
  readonly provider: string;
  readonly model: string;
  /** 1 for the first attempt on a provider, 2 for its one retry. */
  readonly attempt: number;
  readonly outcome: 'OK' | ErrorClass;
  readonly status: number | null;
  readonly latencyMs: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly finishReason: string | null;
}

export interface AttemptSink {
  record(attempt: Attempt): void;
}

/** The daily caps. reserve() runs before each attempt and throws a DAILY_CAP error when a cap is used up or would be. */
export interface CallCaps {
  reserve(estimateUsd: number): void;
  settle(tokens: number, estimateUsd: number, actualUsd: number): void;
}

export interface FailoverOptions {
  readonly hops: readonly Hop[];
  readonly sink?: AttemptSink;
  readonly caps?: CallCaps;
  /** Waits between attempts. Tests replace it. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** A number in [0, 1). Tests replace it to make the jitter exact. */
  readonly random?: () => number;
  readonly now?: () => number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Attempts on one provider. The default is two: the first try and one retry. */
  readonly attemptsPerProvider?: number;
  /** A ceiling on attempts for one logical call across every provider. */
  readonly attemptsPerCall?: number;
}

export const DEFAULT_BASE_DELAY_MS = 1_000;
export const DEFAULT_MAX_DELAY_MS = 20_000;
export const ATTEMPTS_PER_PROVIDER = 2;
export const ATTEMPTS_PER_CALL = 4;

/** The characters a token is assumed to hold when a prompt is measured before it is sent. Two is the conservative choice. */
const CHARS_PER_TOKEN_ESTIMATE = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The wait before retry number `retry` (1 for the first retry): exponential from the base, capped, with equal jitter so
 * that half the wait is fixed and half is random. The random factor is taken from `random`, so tests can make it exact.
 */
export function backoffMs(retry: number, baseMs: number, maxMs: number, random: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** (retry - 1));
  return Math.round(exponential / 2 + (exponential / 2) * random);
}

/** The dollar cost of a number of tokens at a list price. */
export function usdOf(price: Price, promptTokens: number, completionTokens: number): number {
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

/** The worst case of one attempt: the prompt measured conservatively, and the full output limit. */
export function estimateUsdOf(price: Price | null, request: ModelRequest): number {
  if (price === null) return 0;
  const chars = request.messages.reduce((total, message) => total + message.content.length, 0);
  return usdOf(price, Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE), request.maxTokens);
}

/** The actual cost once the provider has reported its tokens, or the reserved worst case when it reported none. */
function actualUsdOf(
  price: Price | null,
  estimate: number,
  promptTokens: number | null,
  completionTokens: number | null,
): number {
  if (price === null || promptTokens === null || completionTokens === null) return estimate;
  return usdOf(price, promptTokens, completionTokens);
}

export function failoverModel(options: FailoverOptions): ModelClient {
  if (options.hops.length === 0) {
    throw new RangeError('the provider chain is empty');
  }
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const baseMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const perProvider = options.attemptsPerProvider ?? ATTEMPTS_PER_PROVIDER;
  const perCall = options.attemptsPerCall ?? ATTEMPTS_PER_CALL;
  const label = options.hops.map((hop) => `${hop.provider}:${hop.model}`).join(' > ');

  return {
    label,
    async complete(request: ModelRequest): Promise<ModelReply> {
      const chain: string[] = [];
      const capped = options.caps !== undefined || request.spend !== undefined;
      let attempts = 0;
      for (const hop of options.hops) {
        if (capped && hop.price === null) {
          // A dollar cap applies, and this provider's cost cannot be bounded, so it is not used.
          chain.push(`${hop.provider}:NO_PRICE`);
          continue;
        }
        for (let attempt = 1; attempt <= perProvider; attempt += 1) {
          if (attempts >= perCall) {
            throw new ModelError('CHAIN_EXHAUSTED', 'the attempt limit for one call was reached', {
              chain,
            });
          }
          attempts += 1;
          // The request this hop sends, and the one its spend is estimated on, carry the same reply limit.
          const sent: ModelRequest =
            hop.maxTokens === undefined ? request : { ...request, maxTokens: hop.maxTokens };
          const estimate = estimateUsdOf(hop.price, sent);
          // The invoice is checked first, then the day. Either refusal throws before anything is sent.
          request.spend?.reserveUsd(estimate);
          options.caps?.reserve(estimate);
          const started = now();
          try {
            const reply = await hop.client.complete(sent);
            const latencyMs = now() - started;
            options.sink?.record({
              provider: hop.provider,
              model: hop.model,
              attempt,
              outcome: 'OK',
              status: 200,
              latencyMs,
              promptTokens: reply.promptTokens ?? null,
              completionTokens: reply.completionTokens ?? null,
              finishReason: reply.finishReason ?? null,
            });
            settleAll(options, request, hop, estimate, reply.promptTokens, reply.completionTokens);
            return reply;
          } catch (error) {
            const failure = toModelError(error);
            const latencyMs = now() - started;
            options.sink?.record({
              provider: hop.provider,
              model: hop.model,
              attempt,
              outcome: failure.errorClass,
              status: failure.status,
              latencyMs,
              promptTokens: failure.promptTokens,
              completionTokens: failure.completionTokens,
              finishReason: failure.finishReason,
            });
            settleAll(
              options,
              request,
              hop,
              estimate,
              failure.promptTokens,
              failure.completionTokens,
            );
            chain.push(`${hop.provider}:${failure.errorClass}`);
            if (
              failure.errorClass === 'BUDGET_EXHAUSTED' ||
              failure.errorClass === 'DAILY_CAP' ||
              failure.errorClass === 'SPEND_CAP'
            ) {
              throw failure;
            }
            if (!RETRYABLE_CLASSES.has(failure.errorClass) || attempt >= perProvider) {
              break;
            }
            const requested = failure.retryAfterMs;
            if (requested !== null && requested > maxMs) {
              break;
            }
            const wait = requested ?? backoffMs(attempt, baseMs, maxMs, random());
            await sleep(wait);
          }
        }
      }
      throw new ModelError('CHAIN_EXHAUSTED', 'every provider in the chain failed', { chain });
    },
  };
}

/** Settles one attempt against the day and against the invoice, at its actual cost. */
function settleAll(
  options: FailoverOptions,
  request: ModelRequest,
  hop: Hop,
  estimate: number,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
): void {
  const prompt = promptTokens ?? null;
  const completion = completionTokens ?? null;
  const actual = actualUsdOf(hop.price, estimate, prompt, completion);
  options.caps?.settle((prompt ?? 0) + (completion ?? 0), estimate, actual);
  request.spend?.settleUsd(estimate, actual);
}

function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) {
    return error;
  }
  // Anything else is a bug or an unexpected failure. It is classed as UNKNOWN and held, never retried blind.
  return new ModelError('UNKNOWN', 'the model call failed unexpectedly');
}
