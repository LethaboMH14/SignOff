import { timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import { z } from 'zod';

import { countsOf, deskRowsOf } from '../model/desk.js';
import { type Operator, type OperatorStore } from './auth/operators.js';
import { hashPassword, verifyPassword } from './auth/passwords.js';
import { LoginGuard, type Session, type SessionStoreApi } from './auth/sessions.js';
import { cookieOf, readBody, sendEmpty, sendJson } from './http.js';
import type { ConsoleMode } from './app.js';
import { invoiceDetailOf } from './invoice-view.js';
import { receiptOf, type ReceiptConfig, type ReceiptLedger } from './receipt.js';
import {
  ApprovalAnswer,
  latestInvoicesOf,
  LimitsAnswer,
  OverviewView,
  ProposalList,
  ProposalView,
  proposalRecordOf,
  readTransitions,
  SupplierList,
  type SupplierView,
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
const INVOICE_PATH = /^\/api\/invoices\/([0-9a-f]{64}|[0-9a-f-]{36})$/;
const RECEIPT_PATH = /^\/api\/receipts\/([0-9a-f-]{36})$/;

/** The Warden calls the console makes for one person. Each method returns the Warden's answer, unparsed. */
export interface WardenPort {
  opsOverview(): Promise<unknown>;
  opsProposals(): Promise<unknown>;
  opsProposal(attemptId: string): Promise<unknown>;
  opsSuppliers(): Promise<unknown>;
  setPaused(paused: boolean): Promise<unknown>;
  setLimits(patch: unknown): Promise<unknown>;
  approveLimits(requestId: string): Promise<unknown>;
}

export interface ApiContext {
  readonly operators: OperatorStore;
  readonly sessions: SessionStoreApi;
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
  /** The ledger a receipt is re-checked against. Null means no receipt can be confirmed. */
  readonly ledger: ReceiptLedger | null;
  /** The receipt's settings: the token issuer, the explorer, and the placeholder rate for the SIMULATED rand figure. */
  readonly receipts: ReceiptConfig;
  /**
   * Drops a fictional test invoice into the agent's inbox, with its order and goods receipt. Present only when the demo
   * launcher runs the console in live mode. The agent and the Warden still check the invoice as they would any other.
   */
  readonly testInvoices?: TestInvoicePort;
}

export interface TestInvoicePort {
  send(zarMinor: number): Promise<{ readonly invoiceNumber: string; readonly usdMinor: number }>;
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
/** A test invoice in rand: R1.00 to R10,000.00, in cents. */
const TestInvoiceBody = z.strictObject({ zarMinor: z.number().int().min(100).max(1_000_000) });

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
  // A stateless store gives the session a new cookie value at a step-up, so the response sets it.
  sendJson(
    response,
    200,
    { stepUpUntil: new Date(until).toISOString() },
    { 'set-cookie': sessionCookie(caller.session.token) },
  );
}

/**
 * A raised limit waiting for a second operator, as the signed-in person may see it. The requester is named by person,
 * and approval is offered only to an operator who is not the requester. The Warden checks the same rule again.
 */
function pendingViewOf(
  pending: OverviewView['pendingLimitChange'],
  caller: Caller,
  ctx: ApiContext,
):
  | (NonNullable<OverviewView['pendingLimitChange']> & {
      readonly approvalAllowed: boolean;
      readonly why: string;
    })
  | null {
  if (pending === null) {
    return null;
  }
  const isRequester = caller.operator.wardenPrincipal === pending.requestedBy;
  const requestedBy = isRequester
    ? 'you'
    : (ctx.operators.byPrincipal(pending.requestedBy)?.username ?? 'another operator');
  const approvalAllowed = caller.operator.role === 'operator' && !isRequester;
  return {
    ...pending,
    requestedBy,
    approvalAllowed,
    why: approvalAllowed
      ? 'A second operator approves this raise. Approval needs your password.'
      : isRequester
        ? 'You asked for this raise, so another operator must approve it.'
        : 'Only operators can approve a raise.',
  };
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
        pendingLimitChange: pendingViewOf(overview.pendingLimitChange, caller, ctx),
      },
      testInvoices: ctx.testInvoices !== undefined && caller.operator.role === 'operator',
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

/** Sends a fictional test invoice to the agent's inbox. Operators only, from this console's page, with its form token. */
async function testInvoice(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
): Promise<void> {
  const caller = callerOf(request, ctx);
  if (caller === null) {
    notSignedIn(response);
    return;
  }
  if (ctx.testInvoices === undefined) {
    sendJson(response, 404, { error: 'test invoices are off; start the console with the demo launcher' });
    return;
  }
  if (!changeAllowed(request, response, ctx, caller, false)) {
    return;
  }
  const body = await jsonBody(request, response, TestInvoiceBody);
  if (body === null) {
    return;
  }
  try {
    const sent = await ctx.testInvoices.send(body.zarMinor);
    sendJson(response, 202, sent);
  } catch {
    sendJson(response, 502, { error: 'the test invoice could not be written' });
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
    const answer = LimitsAnswer.parse(await warden.setLimits(body));
    sendJson(
      response,
      200,
      answer.applied
        ? { applied: true, policyVersion: answer.policyVersion }
        : { applied: false, requestId: answer.requestId, expiresAt: answer.expiresAt },
    );
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
    // The console refuses the requester's own approval before the Warden is asked. The Warden checks it again.
    const pending = OverviewView.parse(await warden.opsOverview()).pendingLimitChange;
    if (pending?.requestId !== requestId) {
      sendJson(response, 409, { error: 'no such limit increase is waiting for approval' });
      return;
    }
    if (pending.requestedBy === caller.operator.wardenPrincipal) {
      sendJson(response, 403, {
        error: 'you asked for this limit increase, so another operator must approve it',
      });
      return;
    }
    const approval = ApprovalAnswer.parse(await warden.approveLimits(requestId));
    sendJson(response, 200, { approved: true, policyVersion: approval.policyVersion });
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
  if (pathname === '/api/demo/invoice' && method === 'POST') {
    await testInvoice(request, response, ctx);
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
  const invoice = INVOICE_PATH.exec(pathname);
  if (invoice !== null && method === 'GET') {
    await invoiceRead(request, response, ctx, invoice[1] ?? '');
    return;
  }
  const receipt = RECEIPT_PATH.exec(pathname);
  if (receipt !== null && method === 'GET') {
    await receiptRead(request, response, ctx, receipt[1] ?? '');
    return;
  }
  sendJson(response, 404, { error: 'not found' });
}

/**
 * The receipt for a paid payment. The desk decides whether the payment is paid, and the receipt re-reads the transaction
 * from the ledger before it shows one.
 */
async function receiptRead(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
  attemptId: string,
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
  const { records } = readTransitions(ctx.transitionsPath);
  const invoice = latestInvoicesOf(records).find((candidate) => candidate.attemptId === attemptId);
  if (invoice === undefined) {
    sendJson(response, 404, { error: 'no such payment' });
    return;
  }
  try {
    const proposal = await proposalOrNull(warden, attemptId);
    if (proposal === null) {
      sendJson(response, 404, { error: 'no such payment' });
      return;
    }
    const row = deskRowsOf([invoice], [proposalRecordOf(proposal)])[0];
    const payment = proposal.payment;
    const view = await receiptOf({
      displayState: row?.displayState ?? 'Received',
      invoiceRef: row?.invoiceRef ?? '',
      payment:
        payment === null
          ? null
          : {
              status: payment.status,
              currency: payment.currency,
              ledgerCurrency: payment.ledgerCurrency,
              amountMinor: payment.amountMinor,
              transactionHash: payment.transactionHash,
            },
      ledger: ctx.ledger,
      config: ctx.receipts,
    });
    sendJson(response, 200, view);
  } catch (error) {
    const failure = wardenFailure(error);
    sendJson(response, failure.status, { error: failure.message });
  }
}

function isStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && error.status === status
  );
}

/** The Warden's view of one attempt, or null when the Warden has recorded no decision for it. */
async function proposalOrNull(warden: WardenPort, attemptId: string): Promise<ProposalView | null> {
  try {
    return ProposalView.parse(await warden.opsProposal(attemptId));
  } catch (error) {
    if (isStatus(error, 404)) {
      return null;
    }
    throw error;
  }
}

/** The held-invoice view. It finds the invoice by its correlation id or its attempt id, and reads nothing it does not show. */
async function invoiceRead(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ApiContext,
  id: string,
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
  const { records } = readTransitions(ctx.transitionsPath);
  const correlationId =
    id.length === 64
      ? id
      : (records.find((record) => record.attemptId === id)?.correlationId ?? null);
  if (correlationId === null || !records.some((record) => record.correlationId === correlationId)) {
    sendJson(response, 404, { error: 'no such invoice' });
    return;
  }
  try {
    const attemptId = latestInvoicesOf(records).find(
      (invoiceRecord) => invoiceRecord.correlationId === correlationId,
    )?.attemptId;
    const proposal =
      attemptId === undefined || attemptId === null
        ? null
        : await proposalOrNull(warden, attemptId);
    const supplierId = proposal?.payment?.supplierId ?? null;
    const supplier: SupplierView | null =
      supplierId === null
        ? null
        : (SupplierList.parse(await warden.opsSuppliers()).suppliers.find(
            (candidate) => candidate.supplierId === supplierId,
          ) ?? null);
    const detail = invoiceDetailOf({ records, correlationId, proposal, supplier });
    if (detail === null) {
      sendJson(response, 404, { error: 'no such invoice' });
      return;
    }
    sendJson(response, 200, detail);
  } catch (error) {
    const failure = wardenFailure(error);
    sendJson(response, failure.status, { error: failure.message });
  }
}
