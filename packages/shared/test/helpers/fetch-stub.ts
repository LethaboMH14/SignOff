// Test-only fetch stubs. No test in this package makes a network request; each live path is driven by one of these.

/** The URL of a fetch input, whichever form it arrives in. */
export function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export interface FetchStub {
  readonly fetch: typeof fetch;
  /** Every URL the code asked for, in order. */
  readonly calls: string[];
}

/** A fetch that records each URL and answers with the given function. */
export function fetchStub(
  respond: (url: string, init?: RequestInit) => Promise<Response>,
): FetchStub {
  const calls: string[] = [];
  const stubbed: typeof fetch = (input, init) => {
    const url = urlOf(input);
    calls.push(url);
    return respond(url, init);
  };
  return { fetch: stubbed, calls };
}

/** A fetch that never answers, and rejects when the caller's time limit fires. */
export function hangingFetch(): typeof fetch {
  const hanging: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('timed out', 'TimeoutError'));
      });
    });
  return hanging;
}

/** A JSON response with the given status. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
