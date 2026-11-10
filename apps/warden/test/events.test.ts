/* eslint-disable security/detect-non-literal-fs-filename -- these tests write only into a temporary directory they create */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';

import { fileEventLog, memoryEventLog, WardenEvent } from '../src/events.js';
import { isUnresolved, WardenState, type AttemptStatus } from '../src/state.js';

const AT = '2026-11-10T10:00:00.000Z';
const LATER = '2026-11-11T10:00:00.000Z';
const UUID = '6f1f2c1e-8b7a-4c55-9d3e-1a2b3c4d5e6f';
const SUPPLIER = 'SUP-ABCD1234';
const DIGEST = 'cd'.repeat(32);
const LOWER_TX_HASH = 'ab'.repeat(32);
const UPPER_TX_HASH = 'AB'.repeat(32);
const NONCE = 'nonce-replay-0009';

const policy: WardenEvent = {
  type: 'policy.limits',
  at: AT,
  policyVersion: '2026-11-10.2',
  perPaymentMinor: 100,
  supplierDailyMinor: 200,
  dailyTotalMinor: 300,
  changedBy: 'operator-a',
};

const paused: WardenEvent = { type: 'pause.set', at: AT, paused: true, changedBy: 'operator-a' };

const directory = mkdtempSync(join(tmpdir(), 'warden-events-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the event log', () => {
  it('reads back exactly what was appended, in order, from memory', async () => {
    const log = memoryEventLog();
    await log.append(policy);
    await log.append(paused);
    expect(await log.readAll()).toEqual([policy, paused]);
    expect(log.events()).toHaveLength(2);
  });

  it('refuses an event that does not match the schema, and stores nothing', async () => {
    const log = memoryEventLog();
    await expect(log.append({ ...paused, extra: 1 } as unknown as WardenEvent)).rejects.toThrow();
    expect(log.events()).toHaveLength(0);
  });

  it('writes each event as a line and reads the same events back from disk', async () => {
    const path = join(directory, 'round-trip', 'events.jsonl');
    expect(await fileEventLog(path).readAll()).toEqual([]);
    await fileEventLog(path).append(policy);
    await fileEventLog(path).append(paused);
    expect(await fileEventLog(path).readAll()).toEqual([policy, paused]);
  });

  it('ignores blank lines, and refuses a line that is not JSON', async () => {
    const path = join(directory, 'blank.jsonl');
    writeFileSync(path, `\n${JSON.stringify(paused)}\n\n`);
    expect(await fileEventLog(path).readAll()).toEqual([paused]);
    appendFileSync(path, 'not json\n');
    await expect(fileEventLog(path).readAll()).rejects.toThrow();
  });

  it('refuses a stored line with a field the schema does not allow', async () => {
    const path = join(directory, 'extra-field.jsonl');
    writeFileSync(path, `${JSON.stringify({ ...paused, extra: true })}\n`);
    await expect(fileEventLog(path).readAll()).rejects.toThrow();
  });
});

describe('the event schema', () => {
  const submitting = {
    type: 'attempt.submitting' as const,
    at: AT,
    attemptId: UUID,
    finalBlob: 'AABBCCDD',
  };

  it('accepts a ledger transaction hash in upper case, as the ledger writes it', () => {
    expect(WardenEvent.parse({ ...submitting, hash: UPPER_TX_HASH }).type).toBe(
      'attempt.submitting',
    );
  });

  it('refuses a transaction hash that is not 64 hexadecimal characters', () => {
    expect(() => WardenEvent.parse({ ...submitting, hash: 'not-a-hash' })).toThrow();
    expect(() => WardenEvent.parse({ ...submitting, hash: LOWER_TX_HASH.slice(2) })).toThrow();
  });

  it('refuses an unknown event type and a payee that is not a classic address', () => {
    expect(() => WardenEvent.parse({ type: 'nope', at: AT })).toThrow();
    expect(() =>
      WardenEvent.parse({
        type: 'supplier.enrolled',
        at: AT,
        supplierId: SUPPLIER,
        payee: { address: 'not-an-address', destinationTag: null },
        publicKey: 'AAAA',
        enrolledBy: 'operator-a',
        identityReference: 'simulated-identity:0123',
      }),
    ).toThrow();
  });
});

describe('replaying events into the state', () => {
  const oldPayee = Wallet.generate().address;
  const newPayee = Wallet.generate().address;
  const OLD_KEY = Buffer.from('old-supplier-key').toString('base64');
  const NEW_KEY = Buffer.from('new-supplier-key').toString('base64');

  function freshState(): WardenState {
    return new WardenState({
      revision: 1,
      policyVersion: '2026-11-10.1',
      perPaymentMinor: 1000,
      supplierDailyMinor: 2000,
      dailyTotalMinor: 3000,
    });
  }

  function enrolAndApprove(state: WardenState): void {
    state.apply({
      type: 'supplier.enrolled',
      at: AT,
      supplierId: SUPPLIER,
      payee: { address: oldPayee, destinationTag: null },
      publicKey: OLD_KEY,
      enrolledBy: 'operator-a',
      identityReference: 'simulated-identity:0123',
    });
    state.apply({
      type: 'supplier.approved',
      at: AT,
      supplierId: SUPPLIER,
      approvedBy: 'operator-b',
    });
  }

  function changeTo(state: WardenState, payee: string, key: string | null): void {
    state.apply({
      type: 'change.requested',
      at: AT,
      supplierId: SUPPLIER,
      changeId: UUID,
      newPayee: { address: payee, destinationTag: null },
      newPublicKey: key,
      requestedAt: AT,
      nonce: NONCE,
    });
    state.apply({
      type: 'change.confirmed',
      at: AT,
      supplierId: SUPPLIER,
      changeId: UUID,
      confirmedBy: 'operator-a',
    });
    state.apply({
      type: 'change.approved',
      at: AT,
      supplierId: SUPPLIER,
      changeId: UUID,
      approvedBy: 'operator-b',
      identityReference: 'simulated-identity:4567',
      coolingOffUntil: LATER,
    });
    state.apply({ type: 'change.applied', at: LATER, supplierId: SUPPLIER, changeId: UUID });
  }

  it('rebuilds limits, pause, approvals and supplier state in the order the events were written', () => {
    const state = freshState();
    state.apply(policy);
    state.apply(paused);
    state.apply({
      type: 'approval.recorded',
      at: AT,
      fingerprint: DIGEST,
      operatorId: 'operator-a',
    });
    enrolAndApprove(state);
    expect(state.limits).toEqual({
      revision: 2,
      policyVersion: '2026-11-10.2',
      perPaymentMinor: 100,
      supplierDailyMinor: 200,
      dailyTotalMinor: 300,
    });
    expect(state.paused).toBe(true);
    expect(state.approvals.get(DIGEST)?.size).toBe(1);
    expect(state.supplierOf(SUPPLIER)).toMatchObject({
      status: 'active',
      approvedBy: 'operator-b',
      change: null,
    });
  });

  it('applies a payout change with a new key, and keeps the key when the change names none', () => {
    const state = freshState();
    enrolAndApprove(state);
    changeTo(state, newPayee, NEW_KEY);
    expect(state.supplierOf(SUPPLIER)).toMatchObject({
      payee: { address: newPayee },
      publicKey: NEW_KEY,
      change: null,
    });
    expect(state.usedChangeNonces.has(NONCE)).toBe(true);

    const keepKey = freshState();
    enrolAndApprove(keepKey);
    changeTo(keepKey, newPayee, null);
    expect(keepKey.supplierOf(SUPPLIER).publicKey).toBe(OLD_KEY);
  });

  it('tracks an attempt from awaiting to submitting to settled', () => {
    const state = freshState();
    state.apply({
      type: 'attempt.awaiting',
      at: AT,
      attemptId: UUID,
      scopedKey: DIGEST,
      obligationKey: DIGEST,
      invoiceFingerprint: DIGEST,
      supplierId: SUPPLIER,
      currency: 'USD',
      ledgerCurrency: 'TST',
      issuer: Wallet.generate().address,
      amountMinor: 1000,
      attemptNumber: 1,
      lastLedgerSequence: 100,
      txFields: '{"Account":"r"}',
      wardenBlob: 'AABB',
      decision: {
        schemaVersion: 1,
        proposalFingerprint: DIGEST,
        policyVersion: '2026-11-10.1',
        evaluatedAt: AT,
        decision: 'ALLOW',
        reasons: [],
      },
    });
    expect(state.attempts.get(UUID)?.status).toBe('awaiting');
    state.apply({
      type: 'attempt.submitting',
      at: AT,
      attemptId: UUID,
      finalBlob: 'AABBCC',
      hash: UPPER_TX_HASH,
    });
    expect(state.attempts.get(UUID)).toMatchObject({
      status: 'submitting',
      finalBlob: 'AABBCC',
      hash: UPPER_TX_HASH,
    });
    state.apply({
      type: 'attempt.settled',
      at: AT,
      attemptId: UUID,
      status: 'paid',
      ledgerIndex: 42,
      engineResult: 'tesSUCCESS',
    });
    expect(state.attempts.get(UUID)).toMatchObject({
      status: 'paid',
      ledgerIndex: 42,
      engineResult: 'tesSUCCESS',
    });
  });

  it('reports which attempt statuses still hold their payable', () => {
    const holding: AttemptStatus[] = ['awaiting', 'submitting', 'held'];
    const released: AttemptStatus[] = ['paid', 'failed', 'rejected', 'expired'];
    expect(holding.map(isUnresolved)).toEqual([true, true, true]);
    expect(released.map(isUnresolved)).toEqual([false, false, false, false]);
  });

  it('refuses an event that refers to something the log never created', () => {
    const state = freshState();
    expect(() => {
      state.apply({
        type: 'supplier.approved',
        at: AT,
        supplierId: SUPPLIER,
        approvedBy: 'operator-b',
      });
    }).toThrow('never enrolled');
    enrolAndApprove(state);
    expect(() => {
      state.apply({
        type: 'change.confirmed',
        at: AT,
        supplierId: SUPPLIER,
        changeId: UUID,
        confirmedBy: 'operator-a',
      });
    }).toThrow('not pending');
    expect(() => {
      state.apply({
        type: 'attempt.settled',
        at: AT,
        attemptId: UUID,
        status: 'paid',
        ledgerIndex: 1,
        engineResult: 'tesSUCCESS',
      });
    }).toThrow('never created');
  });
});
