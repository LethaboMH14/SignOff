import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

import {
  CurrencyCode,
  PayableMinorUnits,
  PolicyVersion,
  Sha256Hex,
  SupplierId,
  WardenDecision,
} from '../../../packages/shared/src/schemas/index.js';

/**
 * The Warden's durable record. Every change to policy, pause state, suppliers, approvals and payment
 * attempts is one line here, written and flushed before the change is acted on. Replaying the lines gives
 * the same state every time, so a restart cannot forget a reservation or a pause.
 */

const Iso = z.iso.datetime();
const Address = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
const Operator = z.string().min(1).max(64);
const PublicKey = z.string().min(1).max(512);
const Tag = z.int().min(0).max(4294967295);
const Uuid = z.uuid();
const Hex = z
  .string()
  .regex(/^[0-9A-Fa-f]+$/)
  .min(2)
  .max(200_000);
/** A ledger transaction hash. Ledger hashes are upper-case hex, unlike the lower-case digests used elsewhere. */
const TxHash = z.string().regex(/^[0-9A-Fa-f]{64}$/);
const Ref = z.string().min(1).max(120);

export const PayeeRecord = z.strictObject({
  address: Address,
  destinationTag: Tag.nullable(),
});
export type PayeeRecord = z.infer<typeof PayeeRecord>;

export const WardenEvent = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('policy.limits'),
    at: Iso,
    policyVersion: PolicyVersion,
    perPaymentMinor: PayableMinorUnits,
    supplierDailyMinor: PayableMinorUnits,
    dailyTotalMinor: PayableMinorUnits,
    changedBy: Operator,
  }),
  z.strictObject({
    type: z.literal('limits.requested'),
    at: Iso,
    requestId: Uuid,
    requestedBy: Operator,
    perPaymentMinor: PayableMinorUnits,
    supplierDailyMinor: PayableMinorUnits,
    dailyTotalMinor: PayableMinorUnits,
    expiresAt: Iso,
  }),
  z.strictObject({
    type: z.literal('limits.approved'),
    at: Iso,
    requestId: Uuid,
    approvedBy: Operator,
    policyVersion: PolicyVersion,
    perPaymentMinor: PayableMinorUnits,
    supplierDailyMinor: PayableMinorUnits,
    dailyTotalMinor: PayableMinorUnits,
  }),
  z.strictObject({
    type: z.literal('limits.expired'),
    at: Iso,
    requestId: Uuid,
    reason: z.enum(['expired', 'superseded']),
  }),
  z.strictObject({
    type: z.literal('pause.set'),
    at: Iso,
    paused: z.boolean(),
    changedBy: Operator,
  }),
  z.strictObject({
    type: z.literal('approval.recorded'),
    at: Iso,
    fingerprint: Sha256Hex,
    operatorId: Operator,
  }),
  z.strictObject({
    type: z.literal('supplier.enrolled'),
    at: Iso,
    supplierId: SupplierId,
    payee: PayeeRecord,
    publicKey: PublicKey,
    enrolledBy: Operator,
    identityReference: Ref,
  }),
  z.strictObject({
    type: z.literal('supplier.approved'),
    at: Iso,
    supplierId: SupplierId,
    approvedBy: Operator,
  }),
  z.strictObject({
    type: z.literal('change.requested'),
    at: Iso,
    supplierId: SupplierId,
    changeId: Uuid,
    newPayee: PayeeRecord,
    newPublicKey: PublicKey.nullable(),
    requestedAt: Iso,
    nonce: z.string().min(16).max(64),
  }),
  z.strictObject({
    type: z.literal('change.confirmed'),
    at: Iso,
    supplierId: SupplierId,
    changeId: Uuid,
    confirmedBy: Operator,
  }),
  z.strictObject({
    type: z.literal('change.approved'),
    at: Iso,
    supplierId: SupplierId,
    changeId: Uuid,
    approvedBy: Operator,
    identityReference: Ref,
    coolingOffUntil: Iso,
  }),
  z.strictObject({
    type: z.literal('change.applied'),
    at: Iso,
    supplierId: SupplierId,
    changeId: Uuid,
  }),
  z.strictObject({
    type: z.literal('decision.recorded'),
    at: Iso,
    attemptId: Uuid,
    decision: WardenDecision,
  }),
  z.strictObject({
    type: z.literal('attempt.awaiting'),
    at: Iso,
    attemptId: Uuid,
    scopedKey: Sha256Hex,
    obligationKey: Sha256Hex,
    invoiceFingerprint: Sha256Hex,
    supplierId: SupplierId,
    currency: CurrencyCode,
    ledgerCurrency: z.string().min(3).max(40),
    issuer: Address,
    amountMinor: PayableMinorUnits,
    attemptNumber: z.int().min(1).max(1000),
    lastLedgerSequence: z.int().min(1),
    txFields: z.string().min(2).max(20_000),
    wardenBlob: Hex,
    decision: WardenDecision,
  }),
  z.strictObject({
    type: z.literal('attempt.submitting'),
    at: Iso,
    attemptId: Uuid,
    finalBlob: Hex,
    hash: TxHash,
  }),
  z.strictObject({
    type: z.literal('attempt.settled'),
    at: Iso,
    attemptId: Uuid,
    status: z.enum(['paid', 'failed', 'rejected', 'expired', 'held']),
    ledgerIndex: z.int().min(1).nullable(),
    engineResult: z.string().min(1).max(40).nullable(),
  }),
]);
export type WardenEvent = z.infer<typeof WardenEvent>;

/**
 * Runs work and returns its result as a promise. A throw inside the work becomes a rejection, so every log method
 * fails the same way, whether it is an in-memory log or a file.
 */
function deferred<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}

/** Append-only storage for events. Reads validate every line, and a line that does not parse is an error. */
export interface EventLog {
  append(event: WardenEvent): Promise<void>;
  readAll(): Promise<WardenEvent[]>;
}

/** An in-memory log for tests. Its contents are lost when the process exits. */
export function memoryEventLog(): EventLog & { readonly events: () => readonly WardenEvent[] } {
  const events: WardenEvent[] = [];
  return {
    append: (event) =>
      deferred(() => {
        events.push(WardenEvent.parse(event));
      }),
    readAll: () => deferred(() => events.map((event) => WardenEvent.parse(event))),
    events: () => events,
  };
}

/** A JSON-lines file, flushed to disk before each append returns. Opened only by the Warden process. */
export function fileEventLog(path: string): EventLog {
  return {
    append: (event) =>
      deferred(() => {
        const line = `${JSON.stringify(WardenEvent.parse(event))}\n`;
        // The directory is the Warden's own private local directory, created on first use.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        // The path is the Warden's own event file in its private local directory.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const fd = openSync(path, 'a', 0o600);
        try {
          // writeFileSync writes every byte of the line; a bare writeSync may write fewer and report it.
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          writeFileSync(fd, line);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }),
    readAll: () =>
      deferred(() => {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (!existsSync(path)) {
          return [];
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const lines = readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line.trim() !== '');
        return lines.map((line) => WardenEvent.parse(JSON.parse(line) as unknown));
      }),
  };
}
