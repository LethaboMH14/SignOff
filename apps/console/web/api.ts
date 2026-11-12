import { type DeskRow, type DisplayState } from '../src/model/desk.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';
import type { ReceiptView } from '../src/server/receipt.js';

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
  readonly pendingLimitChange: PendingRaise | null;
}

/** A raised limit waiting for a second operator, as the signed-in person may see it. */
export interface PendingRaise {
  readonly requestId: string;
  /** The requester by name, or "you" when the signed-in person asked for it. */
  readonly requestedBy: string;
  readonly expiresAt: string;
  readonly perPaymentMinor: number;
  readonly supplierDailyMinor: number;
  readonly dailyTotalMinor: number;
  readonly approvalAllowed: boolean;
  readonly why: string;
}

/** Limits in minor units. A value left out is not changed. */
export interface LimitValues {
  readonly perPaymentMinor?: number;
  readonly supplierDailyMinor?: number;
  readonly dailyTotalMinor?: number;
}

/** A change that waits for the password to be confirmed before it is sent again. */
export type PendingAction =
  | { readonly kind: 'pause'; readonly paused: boolean }
  | { readonly kind: 'limits'; readonly values: LimitValues }
  | { readonly kind: 'approve'; readonly requestId: string };

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

/** The receipt for a paid payment, by its attempt id. The console re-reads the ledger before it gives one. */
export function loadReceipt(attemptId: string): Promise<ReceiptView> {
  return request<ReceiptView>('GET', `/api/receipts/${encodeURIComponent(attemptId)}`);
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

/** Asks for new limits. The answer says whether they applied, or whether a higher one waits for a second operator. */
export function setLimits(
  values: LimitValues,
  csrf: string,
): Promise<{ readonly applied: boolean }> {
  return request('POST', '/api/limits', values, csrf);
}

/** Approves a waiting raise. A second operator makes this call; the console refuses the requester's own approval. */
export function approveLimit(requestId: string, csrf: string): Promise<unknown> {
  return request('POST', `/api/limits/${encodeURIComponent(requestId)}/approve`, undefined, csrf);
}
