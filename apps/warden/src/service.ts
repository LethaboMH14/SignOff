import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import { decode, encode, isValidClassicAddress, type Transaction, type Wallet } from 'xrpl';
import { z } from 'zod';

import { minorToDecimal } from '../../../packages/shared/src/money/minor-units.js';
import { obligationKey } from '../../../packages/shared/src/node.js';
import {
  CurrencyCode,
  PaymentProposal,
  SupplierId,
  WardenDecision,
  type WardenReasonCode,
} from '../../../packages/shared/src/schemas/index.js';
import {
  assertSignedExactly,
  combineSigned,
  hashOfSigned,
  priorAttemptOf,
  resumeAndReconcile,
  sendAndReconcile,
  signAsSigner,
  type Decision,
  type JournalSink,
  type LedgerPort,
  type RegistryAccount,
  type SendPlan,
} from '../../../packages/xrpl/src/index.js';

import type { CoSignResult, ProposeResult } from '../../../packages/warden-api/src/contract.js';

import { canonicalJson, fingerprintOf } from './canonical.js';
import {
  dailyUsage,
  hold,
  limitVerdict,
  matchVerdict,
  preSigningVerdict,
  refuse,
  sastDay,
  scopedKeyOf,
  type Verdict,
} from './checks.js';
import type { WardenConfig } from './config.js';
import { WardenEvent, type EventLog, type PayeeRecord } from './events.js';
import type { EvidenceRegister } from './evidence.js';
import type { IdentityChecker } from './identity.js';
import { readPreSigning, type PreSigningFacts } from './ledger-read.js';
import {
  assertWardenPayment,
  boundFieldsOf,
  GuardError,
  paymentFor,
  type PaymentTerms,
} from './payment.js';
import {
  overviewOf,
  proposalsOf,
  proposalViewOf,
  suppliersOf,
  type OpsOverview,
  type OpsProposal,
  type OpsSupplier,
} from './ops-view.js';
import { isUnresolved, WardenState, type AttemptState, type LimitsState } from './state.js';

/** Errors that map to an HTTP status. Their messages are safe to show the caller. */
export class WardenError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 422 | 503;

  constructor(status: 400 | 404 | 409 | 413 | 422 | 503, message: string) {
    super(message);
    this.name = 'WardenError';
    this.status = status;
  }
}

export interface WardenDeps {
  readonly config: WardenConfig;
  readonly wardenWallet: Wallet;
  readonly log: EventLog;
  readonly journal: JournalSink;
  readonly port: LedgerPort;
  readonly evidence: EvidenceRegister;
  readonly identity: IdentityChecker;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly newId: () => string;
}

export type {
  CoSignResult,
  Outcome,
  ProposeResult,
} from '../../../packages/warden-api/src/contract.js';

const LimitsPatch = z.strictObject({
  perPaymentMinor: z.int().min(1).max(1_000_000_000_000_000).optional(),
  supplierDailyMinor: z.int().min(1).max(1_000_000_000_000_000).optional(),
  dailyTotalMinor: z.int().min(1).max(1_000_000_000_000_000).optional(),
});
export type LimitsPatch = z.infer<typeof LimitsPatch>;

/** The outcome of a limits request: applied at once, or held until a second operator approves it. */
export type LimitsOutcome =
  | { readonly applied: true; readonly policyVersion: string }
  | { readonly applied: false; readonly requestId: string; readonly expiresAt: string };

/** A raised limit waits this long for a second operator, then lapses. A proposed rule, for review. */
export const LIMIT_INCREASE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** An armed Warden pauses itself when no heartbeat has arrived for this long. A proposed setting, for review. */
export const WATCHDOG_WINDOW_MS = 30_000;

/** How often the watchdog timer checks the window. A lapse is recorded at most this long after the window ends. */
export const WATCHDOG_CHECK_MS = 1_000;

/**
 * Starts the watchdog timer for a running Warden. Each tick runs the service's own check under its lock. A failed
 * check is reported through `onError` and the timer keeps running. Returns a function that stops the timer.
 */
export function startWatchdogTimer(
  service: Pick<WardenService, 'checkWatchdog'>,
  onError: (error: unknown) => void,
  everyMs: number = WATCHDOG_CHECK_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    service
      .checkWatchdog()
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, everyMs);
  return () => {
    clearInterval(timer);
  };
}

const PayeeInput = z.strictObject({
  address: z.string().refine((value) => isValidClassicAddress(value), 'not a classic address'),
  destinationTag: z.int().min(0).max(4_294_967_295).nullable(),
});

const EnrolInput = z.strictObject({
  supplierId: SupplierId,
  payee: PayeeInput,
  publicKey: z.string().min(1).max(512),
});
export type EnrolInput = z.infer<typeof EnrolInput>;

/** A payout change, signed by the supplier's current key. The signature covers this exact object. */
const ChangeRequest = z.strictObject({
  supplierId: SupplierId,
  newPayee: PayeeInput,
  newPublicKey: z.string().min(1).max(512).nullable(),
  requestedAt: z.iso.datetime(),
  nonce: z.string().min(16).max(64),
});
export type ChangeRequest = z.infer<typeof ChangeRequest>;

/**
 * The fingerprint an approval binds to: the payment terms. The attempt id and the timestamp are left out, so two
 * operators approve the payment itself, and the approval still holds when the agent proposes it again.
 */
function approvalFingerprintOf(proposal: z.infer<typeof PaymentProposal>): string {
  return fingerprintOf({
    supplierId: proposal.supplierId,
    currency: proposal.currency,
    amountMinor: proposal.amountMinor,
    obligationKey: proposal.obligationKey,
    invoiceFingerprint: proposal.invoiceFingerprint,
    policyVersion: proposal.policyVersion,
  });
}

/** The fields of a transaction, read as a plain object. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WardenError(422, 'not a transaction');
  }
  return value as Record<string, unknown>;
}

function decodeFields(blob: string): Record<string, unknown> {
  try {
    return asRecord(decode(blob));
  } catch {
    throw new WardenError(422, 'not a transaction');
  }
}

/** A reference to a signing account, for the pre-signing check. The check reads only its address and role. */
function accountRef(role: 'agent' | 'warden', address: string, now: Date): RegistryAccount {
  return { role, address, status: 'active', createdAt: now.toISOString() };
}

/** A text field of a record this service wrote itself. A missing field means the record is damaged. */
function textOf(fields: Record<string, unknown>, key: string): string {
  const value: unknown = Reflect.get(fields, key);
  if (typeof value !== 'string') {
    throw new Error('a stored payment attempt is damaged');
  }
  return value;
}

function parseEd25519(base64: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new WardenError(400, 'the public key is not a valid key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new WardenError(400, 'the public key must be Ed25519');
  }
  return key;
}

/** Maps a reconciliation decision to the status the Warden records, or null while the outcome is unknown. */
function settlement(decision: Decision): {
  status: 'paid' | 'failed' | 'rejected' | 'expired' | 'held';
  ledgerIndex: number | null;
  engineResult: string | null;
} | null {
  switch (decision.kind) {
    case 'paid':
      return { status: 'paid', ledgerIndex: decision.ledgerIndex, engineResult: 'tesSUCCESS' };
    case 'failed':
      return {
        status: 'failed',
        ledgerIndex: decision.ledgerIndex,
        engineResult: decision.engineResult,
      };
    case 'rejected':
      return { status: 'rejected', ledgerIndex: null, engineResult: decision.engineResult };
    case 'expired':
      return { status: 'expired', ledgerIndex: null, engineResult: null };
    case 'hold':
      return { status: 'held', ledgerIndex: null, engineResult: null };
    case 'wait':
      return null;
  }
}

interface NewAttempt {
  readonly attemptId: string;
  readonly scopedKey: string;
  readonly obligationKey: string;
  readonly invoiceFingerprint: string;
  readonly supplierId: string;
  readonly currency: string;
  readonly ledgerCurrency: string;
  readonly issuer: string;
  readonly amountMinor: number;
  readonly attemptNumber: number;
  readonly lastLedgerSequence: number;
  readonly txFields: string;
  readonly wardenBlob: string;
}

interface Evaluation {
  readonly decision: WardenDecision;
  readonly attempt: NewAttempt | null;
}

/**
 * The Warden's decision and signing service. Every decision and state change runs one at a time, under a
 * lock, and is written to the event log before it takes effect. Ledger waits happen outside the lock, so a
 * slow submission cannot stall other decisions; the attempt it holds stays reserved while it waits.
 */
export class WardenService {
  private chain: Promise<unknown> = Promise.resolve();
  /** When the last heartbeat arrived, in milliseconds. Null after a restart, so an armed Warden starts paused. */
  private lastHeartbeatMs: number | null = null;

  private constructor(
    private readonly deps: WardenDeps,
    private readonly state: WardenState,
  ) {}

  /** Opens the service by replaying the event log. A log that does not replay stops the Warden. */
  static async open(deps: WardenDeps): Promise<WardenService> {
    const state = new WardenState({
      revision: 1,
      policyVersion: deps.config.policyVersion,
      ...deps.config.initialLimits,
    });
    for (const event of await deps.log.readAll()) {
      state.apply(event);
    }
    const service = new WardenService(deps, state);
    if (state.armed && !state.paused) {
      // A process restart loses the in-memory heartbeat. Fail closed before health or operator reads can say running.
      await service.record({
        type: 'pause.set',
        at: deps.now().toISOString(),
        paused: true,
        changedBy: 'watchdog',
      });
    }
    return service;
  }

  /** Finishes what a previous run left open: reconciles submitted attempts and expires attempts that lapsed. */
  async recover(): Promise<void> {
    await this.exclusive(async () => {
      await this.expireDueAttempts();
      for (const attempt of [...this.state.attempts.values()]) {
        if (
          attempt.status === 'submitting' &&
          attempt.finalBlob !== null &&
          attempt.hash !== null
        ) {
          const decision = await resumeAndReconcile(
            this.planOf(attempt, attempt.finalBlob, attempt.hash),
            this.reliable(),
          );
          await this.settleDecision(attempt.attemptId, decision, attempt.hash);
        }
      }
    });
  }

  health(): { readonly paused: boolean; readonly policyVersion: string } {
    return { paused: this.state.paused, policyVersion: this.state.limits.policyVersion };
  }

  attempt(attemptId: string): AttemptState | undefined {
    return this.state.attempts.get(attemptId);
  }

  supplierPayee(supplierId: string): PayeeRecord | undefined {
    return this.state.suppliers.get(supplierId)?.payee;
  }

  currentLimits(): LimitsState {
    return this.state.limits;
  }

  /** The operator console's reads. Each one returns a view built from the state, so reading changes nothing. */
  opsOverview(): OpsOverview {
    return overviewOf(this.state, this.deps.now());
  }

  opsProposals(): OpsProposal[] {
    return proposalsOf(this.state);
  }

  opsProposal(attemptId: string): OpsProposal | undefined {
    return proposalViewOf(this.state, attemptId);
  }

  opsSuppliers(): OpsSupplier[] {
    return suppliersOf(this.state);
  }

  /** Decides one proposal. An ALLOW reserves the obligation and returns only unsigned payment fields. */
  async propose(raw: unknown): Promise<ProposeResult> {
    const parsed = PaymentProposal.safeParse(raw);
    if (!parsed.success) {
      return {
        attemptId: null,
        decision: this.standalone(
          'REFUSE',
          'INVARIANT_FAILED',
          'the proposal does not match the schema',
          fingerprintOf(raw),
        ),
        toCoSign: null,
      };
    }
    const proposal = parsed.data;
    return this.exclusive(async () => {
      await this.applyDueChanges();
      await this.expireDueAttempts();
      const fingerprint = fingerprintOf(proposal);
      const earlier = this.state.decisions.get(proposal.attemptId);
      if (earlier !== undefined) {
        if (earlier.fingerprint !== fingerprint) {
          return {
            attemptId: proposal.attemptId,
            decision: this.standalone(
              'REFUSE',
              'INVARIANT_FAILED',
              'the attempt id was used for a different proposal',
              fingerprint,
            ),
            toCoSign: null,
          };
        }
        const attempt = this.state.attempts.get(proposal.attemptId);
        return {
          attemptId: proposal.attemptId,
          decision: earlier.decision,
          toCoSign: attempt?.status === 'awaiting' ? attempt.wardenBlob : null,
        };
      }
      const now = this.deps.now();
      const evaluation = await this.evaluate(proposal, fingerprint, now);
      const at = now.toISOString();
      if (evaluation.attempt === null) {
        await this.record({
          type: 'decision.recorded',
          at,
          attemptId: proposal.attemptId,
          decision: evaluation.decision,
        });
        return { attemptId: proposal.attemptId, decision: evaluation.decision, toCoSign: null };
      }
      const created = evaluation.attempt;
      await this.record({
        type: 'attempt.awaiting',
        at,
        attemptId: created.attemptId,
        scopedKey: created.scopedKey,
        obligationKey: created.obligationKey,
        invoiceFingerprint: created.invoiceFingerprint,
        supplierId: created.supplierId,
        currency: CurrencyCode.parse(created.currency),
        ledgerCurrency: created.ledgerCurrency,
        issuer: created.issuer,
        amountMinor: created.amountMinor,
        attemptNumber: created.attemptNumber,
        lastLedgerSequence: created.lastLedgerSequence,
        txFields: created.txFields,
        wardenBlob: created.wardenBlob,
        decision: evaluation.decision,
      });
      return {
        attemptId: created.attemptId,
        decision: evaluation.decision,
        toCoSign: created.wardenBlob,
      };
    });
  }

  /**
   * Verifies the agent-only signature against unsigned prepared terms, rechecks the
   * current pause, policy, payee, limits and ledger state, then Warden signs
   * and submits itself. No Warden co-signature leaves before authorization.
   */
  async coSign(attemptId: string, signedBlob: string): Promise<CoSignResult> {
    const submission = await this.exclusive(async () => {
      await this.enforceWatchdog(this.deps.now());
      const attempt = this.state.attempts.get(attemptId);
      if (attempt === undefined) {
        throw new WardenError(404, 'no such payment attempt');
      }
      if (attempt.status !== 'awaiting') {
        throw new WardenError(409, `the attempt is ${attempt.status}`);
      }
      if ((await this.validatedLedger()) > attempt.lastLedgerSequence) {
        await this.settle(attemptId, 'expired', null, null);
        throw new WardenError(409, 'the attempt has expired; propose again');
      }
      if (this.state.paused) {
        throw new WardenError(409, 'payments are paused; the attempt waits until they resume');
      }
      this.assertPayeeUnchanged(attempt);
      const decision = this.state.decisions.get(attemptId)?.decision;
      if (decision?.policyVersion !== this.state.limits.policyVersion) {
        throw new WardenError(409, 'the policy changed after preparation; propose again');
      }
      const now = this.deps.now();
      const day = sastDay(now);
      const reservedToday = sastDay(new Date(attempt.createdAt)) === day ? attempt.amountMinor : 0;
      const limit = limitVerdict({
        limits: this.state.limits,
        amountMinor: attempt.amountMinor,
        supplierToday:
          dailyUsage(this.state.attempts.values(), day, attempt.supplierId) - reservedToday,
        totalToday: dailyUsage(this.state.attempts.values(), day, null) - reservedToday,
      });
      if (limit !== null) {
        throw new WardenError(409, 'the payment no longer passes the current limits');
      }
      const asset = this.assetFor(attempt.currency);
      if (asset?.ledgerCurrency !== attempt.ledgerCurrency || asset.issuer !== attempt.issuer) {
        throw new WardenError(409, 'the approved payment asset changed');
      }
      const payee = this.supplierOrThrow(attempt.supplierId).payee;
      let facts: PreSigningFacts;
      try {
        facts = await readPreSigning(this.deps.port, {
          spending: this.deps.config.spendingAddress,
          destination: payee.address,
          issuer: asset.issuer,
          ledgerCurrency: asset.ledgerCurrency,
          agent: accountRef('agent', this.deps.config.agentAddress, now),
          warden: accountRef('warden', this.deps.config.wardenAddress, now),
        });
      } catch {
        throw new WardenError(503, 'the ledger could not be read at final authorization');
      }
      const pre = preSigningVerdict(
        facts,
        minorToDecimal(attempt.amountMinor, CurrencyCode.parse(attempt.currency)),
      );
      if (pre !== null) {
        throw new WardenError(409, 'the ledger no longer permits this payment');
      }
      const finalBlob = this.finalizeAgentSignature(attempt, signedBlob);
      const hash = hashOfSigned(finalBlob);
      await this.record({
        type: 'attempt.submitting',
        at: now.toISOString(),
        attemptId,
        finalBlob,
        hash,
      });
      return { attempt, hash, finalBlob };
    });
    let decision: Decision;
    try {
      decision = await sendAndReconcile(
        this.planOf(submission.attempt, submission.finalBlob, submission.hash),
        this.reliable(),
      );
    } catch {
      throw new WardenError(
        503,
        'the outcome is not known yet; the attempt stays reserved until it is reconciled',
      );
    }
    return this.exclusive(() => this.settleDecision(attemptId, decision, submission.hash));
  }

  /**
   * Arms or disarms the watchdog. Arming starts the heartbeat window from now. The change is recorded, so a restart
   * keeps it.
   */
  async setArmed(armed: boolean, actorId: string): Promise<void> {
    await this.exclusive(async () => {
      await this.applyDueChanges();
      const now = this.deps.now();
      await this.record({
        type: 'watchdog.armed',
        at: now.toISOString(),
        armed,
        changedBy: actorId,
      });
      if (armed) {
        this.lastHeartbeatMs = now.getTime();
      }
    });
  }

  /** A heartbeat from an operator's console. It is not logged each time, so the log stays readable. */
  heartbeat(): Promise<void> {
    return this.exclusive(async () => {
      const now = this.deps.now();
      // A late heartbeat must not erase the timeout before the watchdog has recorded a pause.
      await this.enforceWatchdog(now);
      this.lastHeartbeatMs = now.getTime();
    });
  }

  /**
   * The watchdog's own check, run by a timer with no request needed. An armed Warden that has heard no heartbeat
   * within the window records its pause here, so an idle Warden pauses on time rather than at the next request.
   */
  checkWatchdog(): Promise<void> {
    return this.exclusive(() => this.enforceWatchdog(this.deps.now()));
  }

  async setPaused(paused: boolean, actorId: string): Promise<void> {
    await this.exclusive(async () => {
      await this.applyDueChanges();
      await this.record({
        type: 'pause.set',
        at: this.deps.now().toISOString(),
        paused,
        changedBy: actorId,
      });
    });
  }

  /**
   * Changes the limits. A lower limit applies to the next proposal at once, because every decision reads the current
   * limits. It also closes a raise that is waiting for approval, so an old raise cannot undo it later. A raise is not
   * applied here: it waits for a second operator, who must be a different person (see approveLimits).
   */
  async setLimits(patch: unknown, actorId: string): Promise<LimitsOutcome> {
    const parsed = LimitsPatch.safeParse(patch);
    if (!parsed.success) {
      throw new WardenError(400, 'the limits do not match the schema');
    }
    return this.exclusive(async () => {
      await this.applyDueChanges();
      const now = this.deps.now();
      const current = this.state.limits;
      const requested = {
        perPaymentMinor: parsed.data.perPaymentMinor ?? current.perPaymentMinor,
        supplierDailyMinor: parsed.data.supplierDailyMinor ?? current.supplierDailyMinor,
        dailyTotalMinor: parsed.data.dailyTotalMinor ?? current.dailyTotalMinor,
      };
      const raises =
        requested.perPaymentMinor > current.perPaymentMinor ||
        requested.supplierDailyMinor > current.supplierDailyMinor ||
        requested.dailyTotalMinor > current.dailyTotalMinor;
      if (raises) {
        if (this.state.pendingLimits !== null) {
          throw new WardenError(409, 'a limit increase is already waiting for a second operator');
        }
        const requestId = this.deps.newId();
        const expiresAt = new Date(now.getTime() + LIMIT_INCREASE_WINDOW_MS).toISOString();
        await this.record({
          type: 'limits.requested',
          at: now.toISOString(),
          requestId,
          requestedBy: actorId,
          ...requested,
          expiresAt,
        });
        return { applied: false, requestId, expiresAt };
      }
      const pending = this.state.pendingLimits;
      if (pending !== null) {
        await this.record({
          type: 'limits.expired',
          at: now.toISOString(),
          requestId: pending.requestId,
          reason: 'superseded',
        });
      }
      const policyVersion = `${sastDay(now)}.${String(current.revision + 1)}`;
      await this.record({
        type: 'policy.limits',
        at: now.toISOString(),
        policyVersion,
        ...requested,
        changedBy: actorId,
      });
      return { applied: true, policyVersion };
    });
  }

  /**
   * The second operator's approval of a raised limit. It must come from a different person than the one who asked, and
   * it applies the raised values exactly as they were asked for.
   */
  async approveLimits(
    requestId: string,
    actorId: string,
  ): Promise<{ readonly policyVersion: string }> {
    return this.exclusive(async () => {
      await this.applyDueChanges();
      const pending = this.state.pendingLimits;
      if (pending?.requestId !== requestId) {
        throw new WardenError(404, 'no such limit increase is waiting for approval');
      }
      if (pending.requestedBy === actorId) {
        throw new WardenError(
          422,
          'the person who asked for a limit increase cannot also approve it',
        );
      }
      const now = this.deps.now();
      const policyVersion = `${sastDay(now)}.${String(this.state.limits.revision + 1)}`;
      await this.record({
        type: 'limits.approved',
        at: now.toISOString(),
        requestId,
        approvedBy: actorId,
        policyVersion,
        perPaymentMinor: pending.perPaymentMinor,
        supplierDailyMinor: pending.supplierDailyMinor,
        dailyTotalMinor: pending.dailyTotalMinor,
      });
      return { policyVersion };
    });
  }

  /** Records one operator's approval of an exact proposal. Two distinct approvals release a non-plain asset. */
  async approveProposal(
    raw: unknown,
    actorId: string,
  ): Promise<{ readonly fingerprint: string; readonly approvals: number }> {
    const parsed = PaymentProposal.safeParse(raw);
    if (!parsed.success) {
      throw new WardenError(400, 'the proposal does not match the schema');
    }
    const fingerprint = approvalFingerprintOf(parsed.data);
    return this.exclusive(async () => {
      await this.record({
        type: 'approval.recorded',
        at: this.deps.now().toISOString(),
        fingerprint,
        operatorId: actorId,
      });
      return { fingerprint, approvals: this.state.approvals.get(fingerprint)?.size ?? 0 };
    });
  }

  /** Enrols a supplier. The identity check must pass, and a second person must approve before any payment. */
  async enrolSupplier(input: unknown, actorId: string): Promise<void> {
    const parsed = EnrolInput.safeParse(input);
    if (!parsed.success) {
      throw new WardenError(400, 'the supplier does not match the schema');
    }
    parseEd25519(parsed.data.publicKey);
    this.assertExternalPayee(parsed.data.payee.address);
    await this.exclusive(async () => {
      await this.applyDueChanges();
      if (this.state.suppliers.has(parsed.data.supplierId)) {
        throw new WardenError(409, 'the supplier is already enrolled');
      }
      const check = await this.deps.identity.check(parsed.data.supplierId, parsed.data.payee);
      if (check.status !== 'verified') {
        throw new WardenError(422, 'the identity check did not verify the payee');
      }
      await this.record({
        type: 'supplier.enrolled',
        at: this.deps.now().toISOString(),
        supplierId: parsed.data.supplierId,
        payee: parsed.data.payee,
        publicKey: parsed.data.publicKey,
        enrolledBy: actorId,
        identityReference: check.reference,
      });
    });
  }

  async approveSupplier(supplierId: string, actorId: string): Promise<void> {
    await this.exclusive(async () => {
      await this.applyDueChanges();
      const supplier = this.supplierOrThrow(supplierId);
      if (supplier.status !== 'pending') {
        throw new WardenError(409, 'the supplier is already approved');
      }
      if (supplier.enrolledBy === actorId) {
        throw new WardenError(422, 'the person who enrolled a supplier cannot also approve it');
      }
      await this.record({
        type: 'supplier.approved',
        at: this.deps.now().toISOString(),
        supplierId,
        approvedBy: actorId,
      });
    });
  }

  /** A payout change. The request is signed by the supplier's current key; any other key is refused. */
  async requestChange(
    supplierId: string,
    request: unknown,
    signatureBase64: string,
  ): Promise<string> {
    const parsed = ChangeRequest.safeParse(request);
    if (!parsed.success || parsed.data.supplierId !== supplierId) {
      throw new WardenError(400, 'the change request does not match the schema');
    }
    if (parsed.data.newPublicKey !== null) {
      parseEd25519(parsed.data.newPublicKey);
    }
    this.assertExternalPayee(parsed.data.newPayee.address);
    return this.exclusive(async () => {
      await this.applyDueChanges();
      const supplier = this.supplierOrThrow(supplierId);
      if (supplier.status !== 'active') {
        throw new WardenError(409, 'the supplier is not active');
      }
      if (supplier.change !== null) {
        throw new WardenError(409, 'a payout change is already pending for this supplier');
      }
      const now = this.deps.now();
      const requestedMs = Date.parse(parsed.data.requestedAt);
      if (Math.abs(now.getTime() - requestedMs) > 10 * 60 * 1000) {
        throw new WardenError(422, 'the change request is not recent');
      }
      if (this.state.usedChangeNonces.has(parsed.data.nonce)) {
        throw new WardenError(422, 'the change request was already used');
      }
      const signed = Buffer.from(canonicalJson(parsed.data), 'utf8');
      const valid = verify(
        null,
        signed,
        parseEd25519(supplier.publicKey),
        Buffer.from(signatureBase64, 'base64'),
      );
      if (!valid) {
        throw new WardenError(422, "the change is not signed by the supplier's current key");
      }
      const changeId = this.deps.newId();
      await this.record({
        type: 'change.requested',
        at: now.toISOString(),
        supplierId,
        changeId,
        newPayee: parsed.data.newPayee,
        newPublicKey: parsed.data.newPublicKey,
        requestedAt: parsed.data.requestedAt,
        nonce: parsed.data.nonce,
      });
      return changeId;
    });
  }

  async confirmChange(supplierId: string, changeId: string, actorId: string): Promise<void> {
    await this.exclusive(async () => {
      await this.applyDueChanges();
      const change = this.pendingChangeOrThrow(supplierId, changeId);
      if (change.status !== 'requested') {
        throw new WardenError(409, 'the change is not waiting for confirmation');
      }
      await this.record({
        type: 'change.confirmed',
        at: this.deps.now().toISOString(),
        supplierId,
        changeId,
        confirmedBy: actorId,
      });
    });
  }

  /**
   * The second approval of a payout change. It must come from a different person than the confirmation, and
   * the new payee must pass the identity check again. Cooling-off starts here.
   */
  async approveChange(supplierId: string, changeId: string, actorId: string): Promise<void> {
    await this.exclusive(async () => {
      await this.applyDueChanges();
      const change = this.pendingChangeOrThrow(supplierId, changeId);
      if (change.status !== 'confirmed') {
        throw new WardenError(409, 'the change is not confirmed yet');
      }
      if (change.confirmedBy === actorId) {
        throw new WardenError(422, 'the person who confirmed a change cannot also approve it');
      }
      const check = await this.deps.identity.check(supplierId, change.newPayee);
      if (check.status !== 'verified') {
        throw new WardenError(422, 'the identity check did not verify the new payee');
      }
      const now = this.deps.now();
      await this.record({
        type: 'change.approved',
        at: now.toISOString(),
        supplierId,
        changeId,
        approvedBy: actorId,
        identityReference: check.reference,
        coolingOffUntil: new Date(now.getTime() + this.deps.config.coolingOffMs).toISOString(),
      });
    });
  }

  /** Decides one proposal against every rule, in order. The first rule that stops it names the reason. */
  private async evaluate(
    proposal: z.infer<typeof PaymentProposal>,
    fingerprint: string,
    now: Date,
  ): Promise<Evaluation> {
    const config = this.deps.config;
    const stop = (verdict: Verdict): Evaluation => ({
      decision: this.decisionOf(
        verdict.decision,
        [{ code: verdict.code, message: verdict.message }],
        fingerprint,
        now,
      ),
      attempt: null,
    });
    if (this.state.paused) {
      return stop(hold('PAUSED', 'payments are paused'));
    }
    if (proposal.policyVersion !== this.state.limits.policyVersion) {
      return stop(
        hold('INVARIANT_FAILED', 'the proposal names an older policy version; propose again'),
      );
    }
    const supplier = this.state.suppliers.get(proposal.supplierId);
    if (supplier?.status !== 'active') {
      return stop(refuse('SUPPLIER_NOT_APPROVED', 'the supplier is not approved'));
    }
    if (supplier.change !== null) {
      return stop(
        hold(
          'PAYEE_CHANGED',
          'the payout details are changing; payments wait for the change to take effect',
        ),
      );
    }
    const approved = (this.state.approvals.get(approvalFingerprintOf(proposal))?.size ?? 0) >= 2;
    const asset = this.assetFor(proposal.currency);
    if (asset === undefined) {
      return stop(
        refuse('UNSUPPORTED_TRANSACTION', 'no ledger asset is configured for this currency'),
      );
    }
    if (!asset.expected && !approved) {
      return stop(
        refuse(
          'UNSUPPORTED_TRANSACTION',
          'only the expected asset is paid; other assets need two approvals',
        ),
      );
    }
    const invoice = this.deps.evidence.invoice(proposal.invoiceFingerprint);
    if (invoice === undefined) {
      return stop(hold('MISSING_EVIDENCE', 'the invoice is not in the evidence register'));
    }
    if (invoice.supplierId !== proposal.supplierId || invoice.currency !== proposal.currency) {
      return stop(refuse('INVARIANT_FAILED', 'the invoice does not match the proposal'));
    }
    if (obligationKey(invoice.supplierId, invoice.invoiceNumber) !== proposal.obligationKey) {
      return stop(refuse('INVARIANT_FAILED', 'the obligation identity does not match the invoice'));
    }
    if (invoice.amountMinor !== proposal.amountMinor) {
      return stop(hold('AMOUNT_MISMATCH', 'the proposal amount is not the invoice amount'));
    }
    if (
      invoice.payeeAccountAsPrinted !== null &&
      invoice.payeeAccountAsPrinted.trim() !== supplier.payee.address
    ) {
      return stop(
        hold('PAYEE_CHANGED', 'the account printed on the invoice is not the enrolled payee'),
      );
    }
    const scopedKey = scopedKeyOf(config.buyerScope, proposal.obligationKey);
    for (const earlier of this.state.attempts.values()) {
      const blocks = isUnresolved(earlier.status) || earlier.status === 'paid';
      if (
        blocks &&
        (earlier.scopedKey === scopedKey ||
          earlier.invoiceFingerprint === proposal.invoiceFingerprint)
      ) {
        return stop(hold('DUPLICATE', 'this payable already has an unresolved or settled payment'));
      }
    }
    const purchaseOrder =
      invoice.purchaseOrderId === null
        ? undefined
        : this.deps.evidence.purchaseOrder(invoice.purchaseOrderId);
    const receipt =
      purchaseOrder === undefined
        ? undefined
        : this.deps.evidence.goodsReceipt(purchaseOrder.purchaseOrderId);
    const matched = matchVerdict({
      supplierId: proposal.supplierId,
      invoice,
      purchaseOrder,
      receipt,
      tolerance: config.matchTolerance,
    });
    if (matched !== null) {
      return stop(matched);
    }
    const day = sastDay(now);
    const limit = limitVerdict({
      limits: this.state.limits,
      amountMinor: proposal.amountMinor,
      supplierToday: dailyUsage(this.state.attempts.values(), day, proposal.supplierId),
      totalToday: dailyUsage(this.state.attempts.values(), day, null),
    });
    if (limit !== null) {
      return stop(limit);
    }
    // Other hard holds, including over-limit proposals, retain their precise
    // reason. Before any ledger preparation, allow at most one unresolved
    // transaction across ALL payables on this spending account.
    if ([...this.state.attempts.values()].some((attempt) => isUnresolved(attempt.status))) {
      return stop(hold('ACCOUNT_BUSY', 'another transfer on the spending account is unresolved'));
    }
    const terms: PaymentTerms = {
      spending: config.spendingAddress,
      destination: supplier.payee.address,
      destinationTag: supplier.payee.destinationTag,
      asset: { ledgerCurrency: asset.ledgerCurrency, issuer: asset.issuer },
      value: minorToDecimal(proposal.amountMinor, proposal.currency),
    };
    const agent = accountRef('agent', config.agentAddress, now);
    const warden = accountRef('warden', config.wardenAddress, now);
    let facts: PreSigningFacts;
    try {
      facts = await readPreSigning(this.deps.port, {
        spending: config.spendingAddress,
        destination: supplier.payee.address,
        issuer: asset.issuer,
        ledgerCurrency: asset.ledgerCurrency,
        agent,
        warden,
      });
    } catch {
      return stop(hold('LEDGER_UNREADABLE', 'the ledger could not be read before signing'));
    }
    const pre = preSigningVerdict(facts, terms.value);
    if (pre !== null) {
      return stop(pre);
    }
    const prior = await priorAttemptOf(this.deps.journal, scopedKey);
    let attemptNumber: number;
    if (prior.kind === 'none') {
      attemptNumber = 1;
    } else if (prior.kind === 'expired') {
      attemptNumber = prior.view.attempt + 1;
    } else {
      return stop(
        hold('DUPLICATE', 'the ledger journal already holds an unresolved or settled attempt'),
      );
    }
    let wardenBlob: string;
    let lastLedgerSequence: number;
    let txFields: string;
    try {
      const prepared = await this.deps.port.autofill(paymentFor(terms), 2);
      const expiry = prepared.LastLedgerSequence;
      if (expiry === undefined) {
        return stop(refuse('INVARIANT_FAILED', 'the ledger did not set an expiry for the payment'));
      }
      assertWardenPayment(asRecord(prepared), terms);
      // The proposal must NEVER contain a Warden signature: agent can sign only its own half.
      wardenBlob = encode(prepared);
      const signedFields = decodeFields(wardenBlob);
      assertWardenPayment(signedFields, terms);
      txFields = canonicalJson(boundFieldsOf(signedFields));
      lastLedgerSequence = expiry;
    } catch (error) {
      if (error instanceof GuardError) {
        return stop(refuse('INVARIANT_FAILED', error.message));
      }
      return stop(hold('LEDGER_UNREADABLE', 'the payment could not be prepared from the ledger'));
    }
    return {
      decision: this.decisionOf('ALLOW', [], fingerprint, now),
      attempt: {
        attemptId: proposal.attemptId,
        scopedKey,
        obligationKey: proposal.obligationKey,
        invoiceFingerprint: proposal.invoiceFingerprint,
        supplierId: proposal.supplierId,
        currency: proposal.currency,
        ledgerCurrency: asset.ledgerCurrency,
        issuer: asset.issuer,
        amountMinor: proposal.amountMinor,
        attemptNumber,
        lastLedgerSequence,
        txFields,
        wardenBlob,
      },
    };
  }

  /** Finalize an agent-only signature; add Warden's signature only after all last-moment checks. */
  private finalizeAgentSignature(attempt: AttemptState, blob: string): string {
    const signed = decodeFields(blob);
    if (canonicalJson(boundFieldsOf(signed)) !== attempt.txFields) {
      throw new WardenError(422, 'the signed transaction is not the one the Warden prepared');
    }
    const bound = asRecord(JSON.parse(attempt.txFields) as unknown);
    const amount = asRecord(bound['Amount']);
    const tag = bound['DestinationTag'];
    const terms: PaymentTerms = {
      spending: textOf(bound, 'Account'),
      destination: textOf(bound, 'Destination'),
      destinationTag: typeof tag === 'number' ? tag : null,
      asset: { ledgerCurrency: textOf(amount, 'currency'), issuer: textOf(amount, 'issuer') },
      value: textOf(amount, 'value'),
    };
    try {
      assertWardenPayment(signed, terms);
    } catch (error) {
      if (error instanceof GuardError) {
        throw new WardenError(422, error.message);
      }
      throw error;
    }
    try {
      assertSignedExactly(blob, [this.deps.config.agentAddress]);
    } catch {
      throw new WardenError(422, 'the finalization request must carry only the agent signature');
    }
    const prepared = decodeFields(attempt.wardenBlob);
    if (canonicalJson(boundFieldsOf(prepared)) !== attempt.txFields) {
      throw new WardenError(503, 'the stored unsigned transaction has changed');
    }
    const wardenSigned = signAsSigner(this.deps.wardenWallet, prepared as unknown as Transaction);
    const finalBlob = combineSigned([blob, wardenSigned]);
    assertSignedExactly(finalBlob, [this.deps.config.agentAddress, this.deps.config.wardenAddress]);
    return finalBlob;
  }

  private async settleDecision(
    attemptId: string,
    decision: Decision,
    hash: string,
  ): Promise<CoSignResult> {
    const outcome = settlement(decision);
    if (outcome === null) {
      return { attemptId, outcome: 'pending', hash, ledgerIndex: null, engineResult: null };
    }
    await this.settle(attemptId, outcome.status, outcome.ledgerIndex, outcome.engineResult);
    return {
      attemptId,
      outcome: outcome.status,
      hash,
      ledgerIndex: outcome.ledgerIndex,
      engineResult: outcome.engineResult,
    };
  }

  private async settle(
    attemptId: string,
    status: 'paid' | 'failed' | 'rejected' | 'expired' | 'held',
    ledgerIndex: number | null,
    engineResult: string | null,
  ): Promise<void> {
    await this.record({
      type: 'attempt.settled',
      at: this.deps.now().toISOString(),
      attemptId,
      status,
      ledgerIndex,
      engineResult,
    });
  }

  /** Settles every awaiting attempt whose ledger expiry has passed, so it stops holding its payable. */
  private async expireDueAttempts(): Promise<void> {
    const awaiting = [...this.state.attempts.values()].filter(
      (attempt) => attempt.status === 'awaiting',
    );
    if (awaiting.length === 0) {
      return;
    }
    const validated = await this.validatedLedger();
    for (const attempt of awaiting) {
      if (validated > attempt.lastLedgerSequence) {
        await this.settle(attempt.attemptId, 'expired', null, null);
      }
    }
  }

  /**
   * Pauses an armed Warden that has heard no heartbeat within the window. The pause is recorded as the watchdog's, and
   * only an operator's resume lets payments continue. A heartbeat alone does not resume it.
   */
  private async enforceWatchdog(now: Date): Promise<void> {
    if (!this.state.armed || this.state.paused) {
      return;
    }
    const last = this.lastHeartbeatMs;
    if (last !== null && now.getTime() - last <= WATCHDOG_WINDOW_MS) {
      return;
    }
    await this.record({
      type: 'pause.set',
      at: now.toISOString(),
      paused: true,
      changedBy: 'watchdog',
    });
  }

  /** Moves any payout change whose cooling-off has ended into effect. Recorded, so a restart sees the same state. */
  private async applyDueChanges(): Promise<void> {
    const now = this.deps.now();
    await this.enforceWatchdog(now);
    const pending = this.state.pendingLimits;
    if (pending !== null && Date.parse(pending.expiresAt) <= now.getTime()) {
      await this.record({
        type: 'limits.expired',
        at: now.toISOString(),
        requestId: pending.requestId,
        reason: 'expired',
      });
    }
    for (const supplier of [...this.state.suppliers.values()]) {
      const change = supplier.change;
      if (
        change?.status === 'approved' &&
        change.coolingOffUntil !== null &&
        Date.parse(change.coolingOffUntil) <= now.getTime()
      ) {
        await this.record({
          type: 'change.applied',
          at: now.toISOString(),
          supplierId: supplier.supplierId,
          changeId: change.changeId,
        });
      }
    }
  }

  private async record(event: WardenEvent): Promise<void> {
    const parsed = WardenEvent.parse(event);
    await this.deps.log.append(parsed);
    this.state.apply(parsed);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async validatedLedger(): Promise<number> {
    try {
      return await this.deps.port.validatedLedgerIndex();
    } catch {
      throw new WardenError(503, 'the ledger could not be read');
    }
  }

  private supplierOrThrow(supplierId: string) {
    const supplier = this.state.suppliers.get(supplierId);
    if (supplier === undefined) {
      throw new WardenError(404, 'no such supplier');
    }
    return supplier;
  }

  private pendingChangeOrThrow(supplierId: string, changeId: string) {
    const change = this.supplierOrThrow(supplierId).change;
    if (change?.changeId !== changeId) {
      throw new WardenError(404, 'no such pending change');
    }
    return change;
  }

  /** A payee is an outside account. The Warden's own accounts can never be enrolled or changed to as a supplier. */
  private assertExternalPayee(address: string): void {
    const config = this.deps.config;
    if ([config.spendingAddress, config.agentAddress, config.wardenAddress].includes(address)) {
      throw new WardenError(422, "the payee is one of the Warden's own accounts");
    }
  }

  /**
   * An attempt is co-signed only while its payee is the enrolled payee and no payout change is pending. Otherwise
   * the signed transaction would pay an account the business no longer uses; the attempt then lapses by expiry.
   */
  private assertPayeeUnchanged(attempt: AttemptState): void {
    const supplier = this.supplierOrThrow(attempt.supplierId);
    if (supplier.change !== null) {
      throw new WardenError(
        409,
        'the payout details are changing; propose again after the change takes effect',
      );
    }
    const bound = asRecord(JSON.parse(attempt.txFields) as unknown);
    const tag = bound['DestinationTag'];
    const sameTag =
      typeof tag === 'number'
        ? tag === supplier.payee.destinationTag
        : supplier.payee.destinationTag === null;
    if (textOf(bound, 'Destination') !== supplier.payee.address || !sameTag) {
      throw new WardenError(409, 'the enrolled payee changed; propose again');
    }
  }

  /** The ledger asset that pays a currency, and whether it is the expected one. Undefined when none is configured. */
  private assetFor(
    currency: string,
  ):
    | { readonly ledgerCurrency: string; readonly issuer: string; readonly expected: boolean }
    | undefined {
    const config = this.deps.config;
    if (currency === config.expectedAsset.currency) {
      return {
        ledgerCurrency: config.expectedAsset.ledgerCurrency,
        issuer: config.expectedAsset.issuer,
        expected: true,
      };
    }
    const alternate = config.alternateAssets.find((asset) => asset.currency === currency);
    return alternate === undefined
      ? undefined
      : { ledgerCurrency: alternate.ledgerCurrency, issuer: alternate.issuer, expected: false };
  }

  private decisionOf(
    kind: 'ALLOW' | 'HOLD' | 'REFUSE',
    reasons: readonly { readonly code: WardenReasonCode; readonly message: string }[],
    fingerprint: string,
    now: Date,
  ): WardenDecision {
    return WardenDecision.parse({
      schemaVersion: 1,
      proposalFingerprint: fingerprint,
      policyVersion: this.state.limits.policyVersion,
      evaluatedAt: now.toISOString(),
      decision: kind,
      reasons: [...reasons],
    });
  }

  /** A decision for a proposal that never reached evaluation. It is not recorded, because it names no attempt. */
  private standalone(
    kind: 'REFUSE',
    code: WardenReasonCode,
    message: string,
    fingerprint: string,
  ): WardenDecision {
    return this.decisionOf(kind, [{ code, message }], fingerprint, this.deps.now());
  }

  private planOf(attempt: AttemptState, txBlob: string, hash: string): SendPlan {
    return {
      paymentId: attempt.scopedKey,
      attempt: attempt.attemptNumber,
      txBlob,
      hash,
      lastLedgerSequence: attempt.lastLedgerSequence,
      expected: {
        kind: 'iou',
        amount: {
          currency: attempt.ledgerCurrency,
          issuer: attempt.issuer,
          value: minorToDecimal(attempt.amountMinor, CurrencyCode.parse(attempt.currency)),
        },
      },
    };
  }

  private reliable() {
    return {
      port: this.deps.port,
      journal: this.deps.journal,
      now: () => this.deps.now(),
      sleep: this.deps.sleep,
      pollMs: this.deps.config.submission.pollMs,
      maxPolls: this.deps.config.submission.maxPolls,
    };
  }
}
