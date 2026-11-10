import type { ModelClient, ModelReply, ModelRequest } from './types.js';

/**
 * Spaces a client's calls at least a set interval apart. A free or rate-limited provider answers a burst with refusals,
 * and in an evaluation those would look like the model's own failures. A zero interval returns the client unchanged.
 */

export const MAX_INTERVAL_MS = 60_000;

/** The minimum interval from the command line: a whole number of milliseconds, zero when not given. */
export function intervalOf(text: string | undefined): number {
  if (text === undefined) {
    return 0;
  }
  if (!/^\d{1,5}$/.test(text)) {
    throw new RangeError('the minimum interval must be a whole number of milliseconds');
  }
  const value = Number(text);
  if (value > MAX_INTERVAL_MS) {
    throw new RangeError(
      `the minimum interval must be at most ${String(MAX_INTERVAL_MS)} milliseconds`,
    );
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function pacedModel(
  client: ModelClient,
  minIntervalMs: number,
  sleep: (ms: number) => Promise<void> = delay,
): ModelClient {
  if (minIntervalMs === 0) {
    return client;
  }
  // Each call takes the next free slot. The slot is reserved before the wait, so concurrent callers queue in order.
  let nextSlot = 0;
  return {
    label: client.label,
    async complete(request: ModelRequest): Promise<ModelReply> {
      const slot = Math.max(Date.now(), nextSlot);
      nextSlot = slot + minIntervalMs;
      const wait = slot - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      return client.complete(request);
    },
  };
}
