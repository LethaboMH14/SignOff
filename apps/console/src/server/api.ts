import { timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import { z } from 'zod';

import { countsOf, deskRowsOf } from '../model/desk.js';
import { type Operator, type OperatorStore } from './auth/operators.js';
import { hashPassword, verifyPassword } from './auth/passwords.js';
import { LoginGuard, type Session, SessionStore } from './auth/sessions.js';
import { cookieOf, readBody, sendEmpty, sendJson } from './http.js';
import type { ConsoleMode } from './app.js';
import {
  latestInvoicesOf,
  OverviewView,
  ProposalList,
  proposalRecordOf,
  readTransitions,
} from './warden-reads.js';

/**
 * The console's API: sign-in, sign-out, step-up, the desk, and the three changes (pause, limits and a second approval).
 * Every route checks, in this order: a signed-in session, the role, the origin, the form token (CSRF), a recent step-up
 * where one is needed, and only then the body. A refusal names the failed check and nothing else.
 */

export const SESSION_COOKIE = 'signoff_session';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const BODY_LIMIT_BYTES = 4096;
const REQUEST_ID = /^[0-9a-f-]{36}$/;
const APPROVE_PATH = /^\/api\/limits\/([0-9a-f-]{36})\/approve$/;

/** The Warden calls the console makes for one person. Each method returns the Warden's answer, unparsed. */
export interface WardenPort {
  opsOverview(): Promise<unknown>;
  opsProposals(): Promise<unknown>;
  setPaused(paused: boolean): Promise<unknown>;
  setLimits(patch: unknown): Promise<unknown>;
  approveLimits(requestId: string): Promise<unknown>;
}

export interface ApiContext {
  readonly operators: OperatorStore;
  readonly sessions: SessionStore;
  readonly guard: LoginGuard;
  /** The agent's transition log. The console only reads it. */
  readonly transitionsPath: string;
  /** The origins a page may come from, for example http://127.0.0.1:8787. A request from another origin is refused. */
  readonly allowedOrigins: ReadonlySet<string>;
  readonly version: string;
  readonly mode: ConsoleMode;
  /** The Warden as this person: their own principal for an operator, the read-only reader for a viewer, or null. */
  wardenFor(operator: Operator): WardenPort | null;
  readonly now: () => Date;
}

export interface Caller {
  readonly session: Session;
  readonly operator: Operator;
}

/** The signed-in caller for a request, or null. An account removed or re-roled since sign-in loses its session. */
export function callerOf(request: IncomingMessage, ctx: ApiContext): Caller | null {
  const session = ctx.sessions.lookup(cookieOf(request, SESSION_COOKIE));
  if (session === null) {
    return null;
  }
  const operator = ctx.operators.find(session.username);
  if (operator?.role !== session.role) {
    return null;
  }
  return { session, operator };
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function originAllowed(request: IncomingMessage, ctx: ApiContext): boolean {
  const origin = request.headers.origin;
  return origin === undefined || ctx.allowedOrigins.has(origin);
}

const Credentials = z.strictObject({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const StepUpBody = z.strictObject({ password: z.string().min(1).max(256) });
const PauseBody = z.strictObject({ paused: z.boolean() });

const Minor = z.int().min(1).max(1_000_000_000_000);
const LimitsBody = z
  .strictObject({
    perPaymentMinor: Minor.optional(),
    supplierDailyMinor: Minor.optional(),
    dailyTotalMinor: Minor.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

let placeholderHash: Promise<string> | null = null;

/** A hash checked when the username is unknown, so a refused sign-in takes about as long as a wrong password. */
function placeholder(): Promise<string> {
  placeholderHash ??= hashPassword('an-unused-placeholder-password');
  return placeholderHash;
}

async function jsonBody<T>(
  request: IncomingMessage,
  response: ServerResponse,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const text = await readBody(request, BODY_LIMIT_BYTES);
  if (text === null) {
    sendJson(response, 413, { error: 'the request is too large' });
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    sendJson(response, 400, { error: 'the request is not JSON' });
    return null;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    sendJson(response, 400, { error: 'the request does not match what the console accepts' });
    return null;
  }
  return parsed.data;
}

function notSignedIn(response: ServerResponse): void {
  sendJson(response, 401, { error: 'sign in to continue' });
}

/** The form checks every change needs, for any role: the origin, and the form token of this session. */
function formAllowed(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
  caller: Caller,
): boolean {
  if (!originAllowed(request, ctx)) {
    sendJson(response, 403, { error: 'the request came from another origin' });
    return false;
  }
  const token = request.headers['x-signoff-csrf'];
  if (typeof token !== 'string' || !sameText(token, caller.session.csrfToken)) {
    sendJson(response, 403, { error: 'the form token is missing or wrong' });
    return false;
  }
  return true;
}

/** The checks for a change to the Warden: the operator role, the form checks and, if asked, a recent step-up. */
function changeAllowed(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
  caller: Caller,
  stepUpRequired: boolean,
): boolean {
  if (caller.operator.role !== 'operator') {
    sendJson(response, 403, { error: 'this account cannot change the Warden' });
    return false;
  }
  if (!formAllowed(request, response, ctx, caller)) {
    return false;
  }
  if (stepUpRequired && !ctx.sessions.isSteppedUp(caller.session)) {
    sendJson(response, 403, { error: 'confirm your password first', code: 'STEP_UP_REQUIRED' });
    return false;
  }
  return true;
}

/** The Warden's own safe message for a 4xx answer; anything else is reported as the Warden not answering. */
function wardenFailure(error: unknown): { readonly status: number; readonly message: string } {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { readonly status: unknown }).status;
    const message = (error as { readonly message?: unknown }).message;
    if (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      typeof message === 'string'
    ) {
      return { status, message: message.slice(0, 200) };
    }
  }
  return { status: 502, message: 'the Warden did not answer' };
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(SESSION_MAX_AGE_SECONDS)}`;
}

function expiredCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

async function signIn(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
): Promise<void> {
  if (!originAllowed(request, ctx)) {
    sendJson(response, 403, { error: 'the request came from another origin' });
    return;
  }
  const body = await jsonBody(request, response, Credentials);
  if (body === null) {
    return;
  }
  if (ctx.guard.locked(body.username)) {
    sendJson(response, 429, { error: 'too many attempts; wait fifteen minutes and try again' });
    return;
  }
  const operator = ctx.operators.find(body.username);
  const ok = await verifyPassword(body.password, operator?.passwordHash ?? (await placeholder()));
  if (operator === undefined || !ok) {
    ctx.guard.failed(body.username);
    sendJson(response, 401, { error: 'sign-in failed' });
    return;
  }
  ctx.guard.succeeded(body.username);
  const { token, session } = ctx.sessions.open(operator.username, operator.role);
  sendJson(
    response,
    200,
    {
      username: operator.username,
      role: operator.role,
      csrfToken: session.csrfToken,
      stepUp: false,
    },
    { 'set-cookie': sessionCookie(token) },
  );
}

async function stepUp(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
): Promise<void> {
  const caller = callerOf(request, ctx);
  if (caller === null) {
    notSignedIn(response);
    return;
  }
  if (!formAllowed(request, response, ctx, caller)) {
    return;
  }
  const body = await jsonBody(request, response, StepUpBody);
  if (body === null) {
    return;
  }
  if (ctx.guard.locked(caller.operator.username)) {
    sendJson(response, 429, { error: 'too many attempts; wait fifteen minutes and try again' });
    return;
  }
  const ok = await verifyPassword(body.password, caller.operator.passwordHash);
  if (!ok) {
    ctx.guard.failed(caller.operator.username);
    sendJson(response, 401, { error: 'password not accepted' });
    return;
  }
  ctx.guard.succeeded(caller.operator.username);
  const until = ctx.sessions.stepUp(caller.session);
  sendJson(response, 200, { stepUpUntil: new Date(until).toISOString() });
}

async function desk(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
): Promise<void> {
  const caller = callerOf(request, ctx);
  if (caller === null) {
    notSignedIn(response);
    return;
  }
  const warden = ctx.wardenFor(caller.operator);
  if (warden === null) {
    sendJson(response, 503, { error: 'this account has no Warden access' });
    return;
  }
  try {
    const overview = OverviewView.parse(await warden.opsOverview());
    const list = ProposalList.parse(await warden.opsProposals());
    const transitions = readTransitions(ctx.transitionsPath);
    const rows = deskRowsOf(
      latestInvoicesOf(transitions.records),
      list.proposals.map(proposalRecordOf),
    );
    sendJson(response, 200, {
      asOf: ctx.now().toISOString(),
      mode: ctx.mode,
      damagedLines: transitions.damaged,
      overview: {
        paused: overview.paused,
        policyVersion: overview.policyVersion,
        limits: overview.limits,
        usageToday: overview.usageToday,
        pendingLimitChange: overview.pendingLimitChange,
      },
      counts: countsOf(rows),
      rows,
    });
  } catch (error) {
    // A reply that does not match the expected shape is reported the same way as no reply: the Warden did not answer.
    const failure = wardenFailure(error);
    sendJson(response, failure.status, { error: failure.message });
  }
}

async function pause(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
): Promise<void> {
  const caller = callerOf(request, ctx);
  if (caller === null) {
    notSignedIn(response);
    return;
  }
  if (!changeAllowed(request, response, ctx, caller, true)) {
    return;
  }
  const body = await jsonBody(request, response, PauseBody);
  if (body === null) {
    return;
  }
  const warden = ctx.wardenFor(caller.operator);
  if (warden === null) {
    sendJson(response, 503, { error: 'this account has no Warden access' });
    return;
  }
  try {
    await warden.setPaused(body.paused);
    sendJson(response, 200, { paused: body.paused });
  } catch (error) {
    const failure = wardenFailure(error);
    sendJson(response, failure.status, { error: failure.message });
  }
}

async function limits(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
): Promise<void> {
  const caller = callerOf(request, ctx);
  if (caller === null) {
    notSignedIn(response);
    return;
  }
  if (!changeAllowed(request, response, ctx, caller, true)) {
    return;
  }
  const body = await jsonBody(request, response, LimitsBody);
  if (body === null) {
    return;
  }
  const warden = ctx.wardenFor(caller.operator);
  if (warden === null) {
    sendJson(response, 503, { error: 'this account has no Warden access' });
    return;
  }
  try {
    await warden.setLimits(body);
    sendJson(response, 200, { requested: true });
  } catch (error) {
    const failure = wardenFailure(error);
    sendJson(response, failure.status, { error: failure.message });
  }
}

async function approveLimit(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
  requestId: string,
): Promise<void> {
  const caller = callerOf(request, ctx);
  if (caller === null) {
    notSignedIn(response);
    return;
  }
  if (!changeAllowed(request, response, ctx, caller, true)) {
    return;
  }
  if (!REQUEST_ID.test(requestId)) {
    sendJson(response, 400, { error: 'the request id is not recognised' });
    return;
  }
  const warden = ctx.wardenFor(caller.operator);
  if (warden === null) {
    sendJson(response, 503, { error: 'this account has no Warden access' });
    return;
  }
  try {
    await warden.approveLimits(requestId);
    sendJson(response, 200, { approved: true });
  } catch (error) {
    const failure = wardenFailure(error);
    sendJson(response, failure.status, { error: failure.message });
  }
}

/** Routes one /api request. Returns after the response is sent. */
export async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  ctx: ApiContext,
): Promise<void> {
  const method = request.method ?? 'GET';
  if (pathname === '/api/health') {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'method not allowed' });
      return;
    }
    sendJson(response, 200, { status: 'ok', version: ctx.version, mode: ctx.mode });
    return;
  }
  if (pathname === '/api/session') {
    if (method === 'POST') {
      await signIn(request, response, ctx);
      return;
    }
    if (method === 'GET') {
      const caller = callerOf(request, ctx);
      if (caller === null) {
        notSignedIn(response);
        return;
      }
      sendJson(response, 200, {
        username: caller.operator.username,
        role: caller.operator.role,
        csrfToken: caller.session.csrfToken,
        stepUp: ctx.sessions.isSteppedUp(caller.session),
      });
      return;
    }
    if (method === 'DELETE') {
      const caller = callerOf(request, ctx);
      if (caller === null) {
        notSignedIn(response);
        return;
      }
      if (!formAllowed(request, response, ctx, caller)) {
        return;
      }
      ctx.sessions.close(cookieOf(request, SESSION_COOKIE) ?? '');
      sendEmpty(response, 204, { 'set-cookie': expiredCookie() });
      return;
    }
  }
  if (pathname === '/api/session/step-up' && method === 'POST') {
    await stepUp(request, response, ctx);
    return;
  }
  if (pathname === '/api/desk' && method === 'GET') {
    await desk(request, response, ctx);
    return;
  }
  if (pathname === '/api/control/pause' && method === 'POST') {
    await pause(request, response, ctx);
    return;
  }
  if (pathname === '/api/limits' && method === 'POST') {
    await limits(request, response, ctx);
    return;
  }
  const approve = APPROVE_PATH.exec(pathname);
  if (approve !== null && method === 'POST') {
    await approveLimit(request, response, ctx, approve[1] ?? '');
    return;
  }
  sendJson(response, 404, { error: 'not found' });
}
