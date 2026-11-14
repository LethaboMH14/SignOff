import { afterEach, describe, expect, it, vi } from 'vitest';

import { withTimeout } from '../../src/mail/watch.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('a mail check with a time limit', () => {
  it('passes on the result of work that finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('passes on the failure of work that fails in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('refused')), 1000)).rejects.toThrow(
      'refused',
    );
  });

  it('turns a failure that is not an Error into one', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
    await expect(withTimeout(Promise.reject('text'), 1000)).rejects.toThrow('unknown');
  });

  it('gives up on a server that never answers, so the next check can start clean', async () => {
    vi.useFakeTimers();
    const stalled = withTimeout(new Promise<never>(() => undefined), 30_000);
    const outcome = expect(stalled).rejects.toThrow(
      'the mail server did not answer within 30 seconds',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
  });
});
