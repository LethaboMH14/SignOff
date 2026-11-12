import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** A password typed in a test, generated for each run so no credential-looking literal is written here. */
const TYPED_PASSWORD = randomBytes(12).toString('base64url');

import {
  ApiError,
  approveLimit,
  confirmPassword,
  currentSession,
  loadDesk,
  loadInvoice,
  setLimits,
  setPaused,
  signIn,
  signOut,
} from '../web/api.js';

/*
 * The browser's client, tested against a stubbed fetch. Each test checks what the page sends (the path, the form token
 * in its header, the JSON body) and what it makes of the answer.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The JSON a request carried, read from its text body. */
function bodyOf(init: RequestInit): unknown {
  return JSON.parse(typeof init.body === 'string' ? init.body : 'null') as unknown;
}

function fetchAnswering(...responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) {
    mock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the browser client', () => {
  it('reads the signed-in person, and reports nobody signed in on 401', async () => {
    fetchAnswering(
      json(200, { username: 'alice', role: 'operator', csrfToken: 'token', stepUp: false }),
      json(401, { error: 'sign in to continue' }),
    );
    await expect(currentSession()).resolves.toMatchObject({ username: 'alice' });
    await expect(currentSession()).resolves.toBeNull();
  });

  it('rethrows any other failure while it checks the session', async () => {
    fetchAnswering(json(500, { error: 'internal error' }));
    await expect(currentSession()).rejects.toBeInstanceOf(ApiError);
  });

  it('signs in with a JSON body and returns the session', async () => {
    const mock = fetchAnswering(
      json(200, { username: 'alice', role: 'operator', csrfToken: 'token', stepUp: false }),
    );
    const session = await signIn('alice', TYPED_PASSWORD);
    expect(session.csrfToken).toBe('token');
    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/session');
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual({
      username: 'alice',
      password: TYPED_PASSWORD,
    });
  });

  it('signs out with the form token and gets no body back', async () => {
    const mock = fetchAnswering(new Response(null, { status: 204 }));
    await expect(signOut('token-for-tests')).resolves.toBeNull();
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['x-signoff-csrf']).toBe('token-for-tests');
  });

  it('sends a change with the form token in a header and the body as JSON', async () => {
    const mock = fetchAnswering(json(200, { paused: true }));
    await setPaused(true, 'token-for-tests');
    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/control/pause');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(bodyOf(init)).toEqual({ paused: true });
  });

  it('turns a refusal into an error with the console message and its code', async () => {
    fetchAnswering(json(403, { error: 'confirm your password first', code: 'STEP_UP_REQUIRED' }));
    const failure = await setPaused(true, 'token-for-tests').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 403,
      message: 'confirm your password first',
      code: 'STEP_UP_REQUIRED',
    });
  });

  it('uses a plain message when a refusal does not come with one', async () => {
    fetchAnswering(new Response('not json at all', { status: 500 }));
    const failure = await loadDesk().catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 500, message: 'the request failed', code: null });
  });

  it('loads the desk, and an invoice by its id with the id encoded', async () => {
    const mock = fetchAnswering(
      json(200, { rows: [], counts: {}, overview: {} }),
      json(200, { invoiceRef: 'aaaaaaaa' }),
    );
    await loadDesk();
    await loadInvoice('a b/c');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/desk');
    expect(mock.mock.calls[1]?.[0]).toBe('/api/invoices/a%20b%2Fc');
  });

  it('sends a limit change, an approval and a password confirmation, each with the form token', async () => {
    const mock = fetchAnswering(
      json(200, { applied: false, requestId: 'r-1', expiresAt: 'later' }),
      json(200, { approved: true, policyVersion: '2026-11-11.2' }),
      json(200, { stepUpUntil: 'later' }),
    );
    await setLimits({ perPaymentMinor: 900000 }, 'token-for-tests');
    await approveLimit('r-1', 'token-for-tests');
    await confirmPassword(TYPED_PASSWORD, 'token-for-tests');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/limits');
    expect(mock.mock.calls[1]?.[0]).toBe('/api/limits/r-1/approve');
    expect(mock.mock.calls[2]?.[0]).toBe('/api/session/step-up');
    for (const call of mock.mock.calls) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>)['x-signoff-csrf']).toBe('token-for-tests');
    }
  });
});
