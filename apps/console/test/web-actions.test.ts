import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type ActionPorts, confirmAndPerform, performAction } from '../web/actions.js';
import { ApiError, type PendingAction, type SessionInfo } from '../web/api.js';

const SESSION: SessionInfo = {
  username: 'alice',
  role: 'operator',
  csrfToken: 'form-token-for-tests',
  stepUp: false,
};
const PAUSE: PendingAction = { kind: 'pause', paused: true };
/** Passwords typed in these tests, generated for each run. */
const TYPED_PASSWORD = randomBytes(12).toString('base64url');
const WRONG_PASSWORD = randomBytes(12).toString('base64url');

/** Ports that record each call. They fail with the given error when one is supplied. */
function recording(failWith?: Error): ActionPorts & { readonly calls: string[] } {
  const calls: string[] = [];
  const answer = (call: string): Promise<unknown> => {
    calls.push(call);
    return failWith === undefined ? Promise.resolve({}) : Promise.reject(failWith);
  };
  return {
    calls,
    pause: (paused, csrf) => answer(`pause:${String(paused)}:${csrf}`),
    limits: (values, csrf) => answer(`limits:${JSON.stringify(values)}:${csrf}`),
    approve: (requestId, csrf) => answer(`approve:${requestId}:${csrf}`),
    confirm: (_password, csrf) => answer(`confirm:${csrf}`),
  };
}

describe('sending a change', () => {
  it('sends a pause with the form token, and asks the desk to reload', async () => {
    const ports = recording();
    const settled = await performAction(PAUSE, SESSION, ports);
    expect(ports.calls).toEqual([`pause:true:${SESSION.csrfToken}`]);
    expect(settled).toEqual({ pending: null, error: null, refresh: true, session: SESSION });
  });

  it('sends a limit change and an approval to their own calls', async () => {
    const limits = recording();
    await performAction({ kind: 'limits', values: { perPaymentMinor: 900000 } }, SESSION, limits);
    expect(limits.calls).toEqual([`limits:{"perPaymentMinor":900000}:${SESSION.csrfToken}`]);
    const approve = recording();
    await performAction({ kind: 'approve', requestId: 'r-1' }, SESSION, approve);
    expect(approve.calls).toEqual([`approve:r-1:${SESSION.csrfToken}`]);
  });

  it('keeps a change that needs the password, so it can be sent again after it is confirmed', async () => {
    const ports = recording(new ApiError(403, 'confirm your password first', 'STEP_UP_REQUIRED'));
    const settled = await performAction(PAUSE, SESSION, ports);
    expect(settled).toEqual({ pending: PAUSE, error: null, refresh: false, session: SESSION });
  });

  it('shows the console message for any other refusal, and keeps nothing waiting', async () => {
    const ports = recording(new ApiError(409, 'the attempt is paid', null));
    const settled = await performAction(PAUSE, SESSION, ports);
    expect(settled).toEqual({
      pending: null,
      error: 'the attempt is paid',
      refresh: false,
      session: SESSION,
    });
  });

  it('gives a plain message when the failure is not one the console named', async () => {
    const settled = await performAction(PAUSE, SESSION, recording(new Error('network down')));
    expect(settled.error).toBe('The change did not go through. Try again.');
    expect(settled.pending).toBeNull();
  });
});

describe('confirming the password', () => {
  it('confirms, then sends the waiting change with the fresh confirmation', async () => {
    const ports = recording();
    const settled = await confirmAndPerform(TYPED_PASSWORD, SESSION, PAUSE, ports);
    expect(ports.calls).toEqual([
      `confirm:${SESSION.csrfToken}`,
      `pause:true:${SESSION.csrfToken}`,
    ]);
    expect(settled.session).toMatchObject({ stepUp: true });
    expect(settled.session).not.toBe(SESSION);
    expect(settled).toMatchObject({ pending: null, error: null, refresh: true });
  });

  it('confirms without sending anything when no change is waiting', async () => {
    const ports = recording();
    const settled = await confirmAndPerform(TYPED_PASSWORD, SESSION, null, ports);
    expect(ports.calls).toEqual([`confirm:${SESSION.csrfToken}`]);
    expect(settled).toMatchObject({
      pending: null,
      error: null,
      refresh: false,
      session: { stepUp: true },
    });
  });

  it('keeps the change waiting and says why when the password is not accepted', async () => {
    const ports = recording(new ApiError(401, 'password not accepted', null));
    const settled = await confirmAndPerform(WRONG_PASSWORD, SESSION, PAUSE, ports);
    expect(ports.calls).toEqual([`confirm:${SESSION.csrfToken}`]);
    expect(settled).toEqual({
      pending: PAUSE,
      error: 'password not accepted',
      refresh: false,
      session: SESSION,
    });
  });
});
