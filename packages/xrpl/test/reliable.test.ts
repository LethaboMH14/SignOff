import { describe, expect, it } from 'vitest';
import { Wallet, type Client } from 'xrpl';
import { FakeClient, FakeLedger } from './helpers/fake-ledger.js';
import { createXrplPort } from '../src/xrpl-port.js';
import { sendAndReconcile, type SendPlan } from '../src/reliable.js';
import { memoryJournalStore } from '../src/store.js';
import { replay } from '../src/journal.js';
import { signAsSigner, combineSigned, hashOfSigned } from '../src/multisig.js';
import { buildIssuedPayment, buildTrustSet } from '../src/transactions.js';
import type { LedgerPort } from '../src/port.js';

const TOKEN = 'TST';
const NOW = new Date('2026-11-10T10:00:00.000Z');

interface Harness {
  readonly ledger: FakeLedger;
  readonly port: LedgerPort;
  readonly client: FakeClient;
  readonly journal: ReturnType<typeof memoryJournalStore>;
  readonly deps: {
    port: LedgerPort;
    journal: ReturnType<typeof memoryJournalStore>;
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    pollMs: number;
    maxPolls: number;
  };
}

/** Each poll advances the fake ledger by one ledger, so waiting is simulated time. */
function harness(maxPolls = 60): Harness {
  const ledger = new FakeLedger();
  const client = new FakeClient(ledger);
  const port = createXrplPort(client as unknown as Client, 'wss://s.altnet.rippletest.net:51233');
  const journal = memoryJournalStore();
  return {
    ledger,
    port,
    client,
    journal,
    deps: {
      port,
      journal,
      now: () => NOW,
      sleep: () => {
        ledger.advance();
        return Promise.resolve();
      },
      pollMs: 0,
      maxPolls,
    },
  };
}

interface Actors {
  readonly issuer: Wallet;
  readonly holder: Wallet;
  readonly other: Wallet;
}

/** Funds three accounts and prepares a trust line for the holder, so a payment can be made. */
async function actors(h: Harness): Promise<Actors> {
  const issuer = Wallet.generate();
  const holder = Wallet.generate();
  const other = Wallet.generate();
  for (const wallet of [issuer, holder, other]) {
    h.ledger.fund(wallet);
  }
  const trust = buildTrustSet(holder.address, {
    currency: TOKEN,
    issuer: issuer.address,
    value: '1000',
  });
  const prepared = await h.port.autofill(trust, 0);
  const blob = holder.sign(prepared).tx_blob;
  await h.port.submit(blob);
  h.ledger.advance();
  h.ledger.submitted.length = 0;
  return { issuer, holder, other };
}

/** Builds a fully signed plan for a payment from the issuer to the holder. */
async function planFor(
  h: Harness,
  who: Actors,
  value: string,
  expectedValue: string,
  attempt = 1,
): Promise<SendPlan> {
  const payment = buildIssuedPayment(who.issuer.address, who.holder.address, {
    currency: TOKEN,
    issuer: who.issuer.address,
    value,
  });
  const prepared = await h.port.autofill(payment, 0);
  const txBlob = who.issuer.sign(prepared).tx_blob;
  const lastLedgerSequence = prepared.LastLedgerSequence;
  if (lastLedgerSequence === undefined) {
    throw new Error('no LastLedgerSequence');
  }
  return {
    paymentId: 'pay-1',
    attempt,
    txBlob,
    hash: hashOfSigned(txBlob),
    lastLedgerSequence,
    expected: {
      kind: 'iou',
      amount: { currency: TOKEN, issuer: who.issuer.address, value: expectedValue },
    },
  };
}

describe('sendAndReconcile', () => {
  it('pays a validated payment that delivered the expected amount, and journals every step', async () => {
    const h = harness();
    const a = await actors(h);
    const plan = await planFor(h, a, '25', '25');
    const decision = await sendAndReconcile(plan, h.deps);
    expect(decision).toEqual({ kind: 'paid', ledgerIndex: expect.any(Number) as number });
    expect(h.ledger.line(a.holder.address, TOKEN, a.issuer.address)?.balance).toBe(25);
    const states = h.journal.records().map((record) => record.state);
    expect(states).toEqual(['prepared', 'submitting', 'submitted', 'paid']);
    expect(h.ledger.submitted.length).toBe(1);
  });

  it('records a rejection as rejected and stops, without waiting for ledgers', async () => {
    const h = harness();
    const a = await actors(h);
    const plan = await planFor(h, a, '5', '5');
    const payment = await h.port.autofill(
      buildIssuedPayment(a.issuer.address, a.holder.address, {
        currency: TOKEN,
        issuer: a.issuer.address,
        value: '5',
      }),
      0,
    );
    const wrongSigner = a.other.sign(payment).tx_blob;
    const decision = await sendAndReconcile(
      { ...plan, txBlob: wrongSigner, hash: hashOfSigned(wrongSigner) },
      h.deps,
    );
    expect(decision).toEqual({ kind: 'rejected', engineResult: 'tefBAD_AUTH' });
    expect(h.journal.records().map((record) => record.state)).toEqual([
      'prepared',
      'submitting',
      'rejected',
    ]);
  });

  it('survives a lost response: reconciles by hash and applies the payment exactly once', async () => {
    const h = harness();
    const a = await actors(h);
    const plan = await planFor(h, a, '7', '7');
    h.ledger.loseNextResponse();
    const decision = await sendAndReconcile(plan, h.deps);
    expect(decision.kind).toBe('paid');
    expect(h.ledger.line(a.holder.address, TOKEN, a.issuer.address)?.balance).toBe(7);
    expect(new Set(h.ledger.submitted).size).toBe(1);
    expect(h.journal.records().some((record) => record.reason === 'no-response')).toBe(true);
  });

  it('expires an attempt that never reached the network, and only then allows a new attempt', async () => {
    const h = harness(80);
    const a = await actors(h);
    const plan = await planFor(h, a, '3', '3');
    h.ledger.refuseSubmissions(true);
    const decision = await sendAndReconcile(plan, h.deps);
    h.ledger.refuseSubmissions(false);
    expect(decision.kind).toBe('expired');
    expect(h.ledger.line(a.holder.address, TOKEN, a.issuer.address)?.balance).toBe(0);
    expect(replay(await h.journal.readAll()).get('pay-1')?.state).toBe('expired');

    const retry = await planFor(h, a, '3', '3', 2);
    const next = await sendAndReconcile(retry, h.deps);
    expect(next.kind).toBe('paid');
    const views = replay(await h.journal.readAll());
    expect(views.get('pay-1')?.attempt).toBe(2);
    expect(views.get('pay-1')?.state).toBe('paid');
  });

  it('holds a validated payment whose delivered amount does not match what was intended', async () => {
    const h = harness();
    const a = await actors(h);
    const plan = await planFor(h, a, '4', '5');
    const decision = await sendAndReconcile(plan, h.deps);
    expect(decision).toEqual({ kind: 'hold', reason: 'delivered-mismatch' });
    expect(h.journal.records().at(-1)?.state).toBe('held');
  });

  it('journals a validated failure as failed, with its result code', async () => {
    const h = harness();
    const a = await actors(h);
    const plan = await planFor(h, a, '9999', '9999');
    const decision = await sendAndReconcile(plan, h.deps);
    expect(decision).toEqual({
      kind: 'failed',
      engineResult: 'tecPATH_DRY',
      ledgerIndex: expect.any(Number) as number,
    });
    expect(h.journal.records().at(-1)?.engineResult).toBe('tecPATH_DRY');
  });

  it('returns wait when the poll budget runs out, leaving the journal open for a later run', async () => {
    const h = harness(0);
    const a = await actors(h);
    const plan = await planFor(h, a, '2', '2');
    const decision = await sendAndReconcile(plan, { ...h.deps, maxPolls: 0 });
    expect(decision).toEqual({ kind: 'wait' });
    expect(replay(await h.journal.readAll()).get(plan.paymentId)?.state).toBe('submitted');
  });

  it('resends only the identical blob while the outcome is unknown', async () => {
    const h = harness();
    const a = await actors(h);
    const plan = await planFor(h, a, '6', '6');
    h.ledger.loseNextResponse();
    await sendAndReconcile(plan, h.deps);
    expect(new Set(h.ledger.submitted).size).toBe(1);
  });

  it('builds a two-signer blob that the reliable path can carry', async () => {
    const h = harness();
    const a = await actors(h);
    const payment = buildIssuedPayment(a.issuer.address, a.holder.address, {
      currency: TOKEN,
      issuer: a.issuer.address,
      value: '1',
    });
    const prepared = await h.port.autofill(payment, 2);
    const combined = combineSigned([
      signAsSigner(a.issuer, prepared),
      signAsSigner(a.other, prepared),
    ]);
    expect(combined.length).toBeGreaterThan(0);
  });
});
