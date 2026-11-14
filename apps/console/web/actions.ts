import { ApiError, type LimitValues, type PendingAction, type SessionInfo } from './api.js';

/**
 * What happens after a change is asked for. A change the console refuses for want of a recent password waits; the
 * password is asked for; the same change is then sent again. This module decides the next state, so the desk's screen
 * only shows it. The calls to the console are passed in, so the rules can be tested without a browser.
 */

export interface ActionPorts {
  pause(paused: boolean, csrf: string): Promise<unknown>;
  limits(values: LimitValues, csrf: string): Promise<unknown>;
  approve(requestId: string, csrf: string): Promise<unknown>;
  confirm(password: string, csrf: string): Promise<unknown>;
}

/** The next state of the desk after a change: what waits, what went wrong, whether to reload, and the session. */
export interface Settled {
  readonly pending: PendingAction | null;
  readonly error: string | null;
  readonly refresh: boolean;
  readonly session: SessionInfo;
}

function messageOf(failure: unknown): string {
  return failure instanceof ApiError
    ? failure.message
    : 'The change did not go through. Try again.';
}

/** Sends one change. The console may refuse it for want of a recent password; then it waits. */
export async function performAction(
  action: PendingAction,
  session: SessionInfo,
  ports: ActionPorts,
): Promise<Settled> {
  try {
    if (action.kind === 'pause') {
      await ports.pause(action.paused, session.csrfToken);
    } else if (action.kind === 'limits') {
      await ports.limits(action.values, session.csrfToken);
    } else {
      await ports.approve(action.requestId, session.csrfToken);
    }
    return { pending: null, error: null, refresh: true, session };
  } catch (failure) {
    if (failure instanceof ApiError && failure.code === 'STEP_UP_REQUIRED') {
      return { pending: action, error: null, refresh: false, session };
    }
    return { pending: null, error: messageOf(failure), refresh: false, session };
  }
}

/** Confirms the password, then sends the waiting change, if there is one, with the fresh confirmation. */
export async function confirmAndPerform(
  password: string,
  session: SessionInfo,
  pending: PendingAction | null,
  ports: ActionPorts,
): Promise<Settled> {
  try {
    await ports.confirm(password, session.csrfToken);
  } catch (failure) {
    return { pending, error: messageOf(failure), refresh: false, session };
  }
  const fresh: SessionInfo = { ...session, stepUp: true };
  if (pending === null) {
    return { pending: null, error: null, refresh: false, session: fresh };
  }
  return performAction(pending, fresh, ports);
}
