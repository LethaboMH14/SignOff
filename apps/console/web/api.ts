import { type DeskRow, type DisplayState } from '../src/model/desk.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';

/**
 * The browser's calls to the console's API. The browser holds no secret: the session is an HttpOnly cookie it cannot
 * read, and the form token it does hold is sent back in a header on every change.
 */

export type Role = 'viewer' | 'operator';

export interface SessionInfo {
  readonly username: string;
  readonly role: Role;
  readonly csrfToken: string;
  readonly stepUp: boolean;
}

export interface DeskOverview {
  readonly paused: boolean;
  readonly policyVersion: string;
  readonly limits: {
    readonly perPaymentMinor: number;
    readonly supplierDailyMinor: number;
    readonly dailyTotalMinor: number;
  };
  readonly usageToday: { readonly day: string; readonly totalMinor: number };
  readonly pendingLimitChange: {
    readonly requestId: string;
    readonly requestedBy: string;
    readonly expiresAt: string;
  } | null;
}

export interface DeskData {
  readonly asOf: string;
  readonly mode: 'simulated' | 'live';
  readonly damagedLines: number;
  readonly overview: DeskOverview;
  readonly counts: Readonly<Record<DisplayState, number>>;
  readonly rows: readonly DeskRow[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A text field of a JSON answer, or null when the answer has no such text field. */
function fieldOf(value: unknown, name: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const entry = Object.entries(value).find(([key]) => key === name);
  return typeof entry?.[1] === 'string' ? entry[1] : null;
}

/** The JSON in an answer, or null when there is none or it is not JSON. */
function jsonOf(text: string): unknown {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown, csrf?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (csrf !== undefined) {
    headers['x-signoff-csrf'] = csrf;
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = jsonOf(await response.text());
  if (!response.ok) {
    throw new ApiError(
      response.status,
      fieldOf(json, 'error') ?? 'the request failed',
      fieldOf(json, 'code'),
    );
  }
  return json as T;
}

/** The signed-in person, or null when nobody is signed in. */
export async function currentSession(): Promise<SessionInfo | null> {
  try {
    return await request<SessionInfo>('GET', '/api/session');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function signIn(username: string, password: string): Promise<SessionInfo> {
  return request<SessionInfo>('POST', '/api/session', { username, password });
}

export function signOut(csrf: string): Promise<unknown> {
  return request('DELETE', '/api/session', undefined, csrf);
}

export function confirmPassword(password: string, csrf: string): Promise<{ stepUpUntil: string }> {
  return request('POST', '/api/session/step-up', { password }, csrf);
}

/** The held-invoice view for one invoice, by its correlation id or its attempt id. */
export function loadInvoice(id: string): Promise<InvoiceDetail> {
  return request<InvoiceDetail>('GET', `/api/invoices/${encodeURIComponent(id)}`);
}

export function loadDesk(): Promise<DeskData> {
  return request<DeskData>('GET', '/api/desk');
}

export function setPaused(paused: boolean, csrf: string): Promise<unknown> {
  return request('POST', '/api/control/pause', { paused }, csrf);
}
