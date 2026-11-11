import { describe, expect, it } from 'vitest';
import { Wallet, type Client } from 'xrpl';
import { FakeClient, FakeLedger } from './helpers/fake-ledger.js';
import { createXrplPort } from '../src/xrpl-port.js';
import { provisionTestnet, type ProvisionDeps } from '../src/provision.js';
import { configureSigners } from '../src/signers.js';
import { memoryJournalStore, memoryRegistryStore } from '../src/store.js';
import { JournalError, replay, type JournalRecord, type JournalState } from '../src/journal.js';
import type { Decision } from '../src/reconcile.js';
import { sendAndReconcile } from '../src/reliable.js';
import {
  loadSigners,
  PaymentError,
  planTwoSignature,
  rlusdAmount,
  sendTwoSignatureTransfer,
  testTokenAmount,
  type PaymentDeps,
  type Transfer,
} from '../src/payments.js';
import { demonstrateRejections } from '../src/rejections.js';
import { failoverDrill, timeoutDrill } from '../src/drills.js';
import { rebuildFromReserve } from '../src/rebuild.js';
import { TEST_TOKEN_CURRENCY, RLUSD_TESTNET } from '../src/constants.js';
import type { LedgerPort } from '../src/port.js';
import type { Registry, RegistryAccount } from '../src/registry.js';

/** Narrows a lookup result, failing the test with a clear message when it is missing. */
function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

interface World {
  readonly ledger: FakeLedger;
  readonly port: LedgerPort;
  readonly registry: ReturnType<typeof memoryRegistryStore>;
  readonly journal: ReturnType<typeof memoryJournalStore>;
  readonly deps: ProvisionDeps & PaymentDeps;
}

function world(maxPolls = 60): World {
  const ledger = new FakeLedger();
  const client = new FakeClient(ledger);
  const port = createXrplPort(client as unknown as Client, 'wss://s.altnet.rippletest.net:51233');
  const registry = memoryRegistryStore();
  const journal = memoryJournalStore();
  let counter = 0;
  const deps: ProvisionDeps & PaymentDeps = {
    port,
    journal,
    registry,
    now: () => new Date('2026-11-10T10:00:00.000Z'),
    sleep: () => {
      ledger.advance();
      return Promise.resolve();
    },
    pollMs: 0,
    maxPolls,
    newId: () => {
      counter += 1;
      return `id${String(counter)}`;
    },
    newWallet: () => {
      const wallet = Wallet.generate();
      ledger.expect(wallet);
      return wallet;
    },
    log: () => undefined,
    maxAttempts: 3,
  };
  return { ledger, port, registry, journal, deps };
}

/** Provisions the testnet and configures the spending account's signers, as the CLI does in order. */
async function ready(w: World): Promise<void> {
  await provisionTestnet(w.deps);
  await configureSigners(w.deps);
}

function accounts(w: World): {
  spending: RegistryAccount;
  supplier: RegistryAccount;
  issuer: RegistryAccount;
  agent: RegistryAccount;
  warden: RegistryAccount;
  reserve: RegistryAccount;
} {
  const registry: Registry = must(w.registry.current(), 'registry was not written');
  const find = (role: RegistryAccount['role']) =>
    must(
      registry.accounts.find((account) => account.role === role && account.status !== 'abandoned'),
      `no ${role} account`,
    );
  return {
    spending: find('spending'),
    supplier: find('supplier'),
    issuer: find('issuer'),
    agent: find('agent'),
    warden: find('warden'),
    reserve: find('reserve'),
  };
}

function testTokenBalance(w: World, holder: RegistryAccount, issuer: RegistryAccount): string {
  return (
    w.ledger.line(holder.address, TEST_TOKEN_CURRENCY, issuer.address)?.balance.toString() ?? 'none'
  );
}

describe('two-signature transfers', () => {
  it('pays through the two signers and moves the test token from the spending account to the supplier', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'pay.first',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '10'),
    };
    const outcome = await sendTwoSignatureTransfer(w.deps, transfer);
    expect(outcome.decision.kind).toBe('paid');
    expect(outcome.attempts).toBe(1);
    expect(outcome.hash).toMatch(/^[0-9A-F]{64}$/);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('10');
    expect(testTokenBalance(w, a.spending, a.issuer)).toBe('990');
  });

  it('refuses to pay while the master key is still enabled', async () => {
    const w = world();
    await provisionTestnet(w.deps);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'pay.early',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '1'),
    };
    await expect(sendTwoSignatureTransfer(w.deps, transfer)).rejects.toThrow(PaymentError);
  });

  it('replaces an expired attempt with a fresh one under the same payment identity', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    w.ledger.refuseSubmissions(true);
    const deps: PaymentDeps & ProvisionDeps = {
      ...w.deps,
      log: (event) => {
        if (event === 'payment_attempt_expired') {
          w.ledger.refuseSubmissions(false);
        }
      },
    };
    const outcome = await sendTwoSignatureTransfer(deps, {
      paymentId: 'pay.retry',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '2'),
    });
    expect(outcome.decision.kind).toBe('paid');
    expect(outcome.attempts).toBe(2);
    const view = replay(await w.journal.readAll()).get('pay.retry');
    expect(view?.state).toBe('paid');
    expect(view?.attempt).toBe(2);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('2');
  });

  it('stops with wait, without a second attempt, when the poll budget runs out', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const outcome = await sendTwoSignatureTransfer(
      { ...w.deps, maxPolls: 1 },
      {
        paymentId: 'pay.slow',
        from: a.spending,
        to: a.supplier,
        amount: testTokenAmount(a.issuer, '1'),
      },
    );
    expect(outcome.decision).toEqual({ kind: 'wait' });
    expect(outcome.attempts).toBe(1);
  });

  it('reports the testnet RLUSD amount with its real currency code and issuer', () => {
    const amount = rlusdAmount('5');
    expect(amount).toEqual({
      kind: 'iou',
      amount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value: '5' },
    });
  });
});

describe('single-key rejections (A4)', () => {
  it('shows that neither key alone can pay or change the signers, and that the recipient is unchanged', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const report = await demonstrateRejections(w.deps, {
      paymentId: 'refusal',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '10'),
    });
    expect(report.refusals.length).toBe(4);
    expect(report.refusals.every((refusal) => refusal.outcome === 'tefBAD_QUORUM')).toBe(true);
    expect(report.refusals.map((refusal) => refusal.signer).sort()).toEqual([
      'agent',
      'agent',
      'warden',
      'warden',
    ]);
    expect(report.recipientUnchanged).toBe(true);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('0');
  });
});

describe('reliability drills (A5, A6)', () => {
  it('settles a payment exactly once after its response is lost, reconciling by hash', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const report = await timeoutDrill(w.deps, {
      paymentId: 'drill',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '4'),
    });
    expect(report.decision.kind).toBe('paid');
    expect(report.distinctBlobs).toBe(1);
    expect(report.submissions).toBeGreaterThan(1);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('4');
  });

  it('settles the same signed blob on the secondary endpoint after the primary fails, under the same hash', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const secondaryClient = new FakeClient(w.ledger);
    const secondary = createXrplPort(
      secondaryClient as unknown as Client,
      'wss://testnet.xrpl-labs.com',
    );
    const report = await failoverDrill(
      w.deps,
      {
        paymentId: 'failover',
        from: a.spending,
        to: a.supplier,
        amount: testTokenAmount(a.issuer, '3'),
      },
      secondary,
    );
    expect(report.decision.kind).toBe('paid');
    expect(report.primary).toBe('wss://s.altnet.rippletest.net:51233');
    expect(report.secondary).toBe('wss://testnet.xrpl-labs.com');
    expect(report.hash).toMatch(/^[0-9A-F]{64}$/);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('3');
  });
});

describe('rebuild from the reserve (A7)', () => {
  it('abandons the old account, rebuilds a working one from the reserve, and refunds the old one', async () => {
    const w = world();
    await ready(w);
    const before = accounts(w);
    const report = await rebuildFromReserve(w.deps, {
      fundingDrops: '20000000',
      paymentAmount: testTokenAmount(before.issuer, '5'),
      refundMarginDrops: '100000',
    });
    expect(report.payment.decision.kind).toBe('paid');
    expect(report.refundXrp).not.toBe('nothing-to-refund');
    expect(report.refundToken).not.toBe('nothing-to-refund');
    if (report.refundToken !== 'nothing-to-refund') {
      expect(report.refundToken.decision.kind).toBe('paid');
    }
    const registry: Registry = must(w.registry.current(), 'registry was not written');
    const spendingStatuses = registry.accounts
      .filter((account) => account.role === 'spending')
      .map((account) => account.status);
    expect(spendingStatuses.sort()).toEqual(['abandoned', 'master-disabled']);
    expect(testTokenBalance(w, before.spending, before.issuer)).toBe('0');
    expect(testTokenBalance(w, before.supplier, before.issuer)).toBe('5');
  });
});

describe('a repeated run never sends a payment twice', () => {
  it('returns the recorded result for a settled payment and sends nothing', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'pay.once',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '10'),
    };
    const first = await sendTwoSignatureTransfer(w.deps, transfer);
    const submittedBefore = w.ledger.submitted.length;
    const recordsBefore = (await w.journal.readAll()).length;
    const second = await sendTwoSignatureTransfer(w.deps, transfer);
    expect(second).toEqual(first);
    expect(w.ledger.submitted.length).toBe(submittedBefore);
    expect((await w.journal.readAll()).length).toBe(recordsBefore);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('10');
  });

  it('refuses a settled payment id that names different terms, and sends nothing', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    await sendTwoSignatureTransfer(w.deps, {
      paymentId: 'pay.terms',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '10'),
    });
    const submittedBefore = w.ledger.submitted.length;
    await expect(
      sendTwoSignatureTransfer(w.deps, {
        paymentId: 'pay.terms',
        from: a.spending,
        to: a.supplier,
        amount: testTokenAmount(a.issuer, '11'),
      }),
    ).rejects.toThrow(PaymentError);
    expect(w.ledger.submitted.length).toBe(submittedBefore);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('10');
  });

  it('resumes an unresolved attempt with its stored blob, and never builds a new transaction', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'pay.resume',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '6'),
    };
    const plan = await planTwoSignature(w.deps, transfer, await loadSigners(w.deps), 1);
    const stored = {
      paymentId: plan.paymentId,
      attempt: 1,
      at: '2026-11-10T10:00:00.000Z',
      hash: plan.hash,
      txBlob: plan.txBlob,
      lastLedgerSequence: plan.lastLedgerSequence,
    };
    await w.journal.append({ ...stored, state: 'prepared' });
    await w.journal.append({ ...stored, state: 'submitting' });
    // The process stopped after journaling and before any response: the blob may or may not be on the ledger.
    const before = w.ledger.submitted.length;
    const outcome = await sendTwoSignatureTransfer(w.deps, transfer);
    expect(outcome.decision.kind).toBe('paid');
    expect(outcome.hash).toBe(plan.hash);
    expect(outcome.attempts).toBe(1);
    expect(w.ledger.submitted.slice(before)).toEqual([plan.txBlob]);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('6');
    expect(replay(await w.journal.readAll()).get('pay.resume')?.state).toBe('paid');
  });

  it('refuses to resume a stored attempt whose terms differ from the request', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const stored: Transfer = {
      paymentId: 'pay.drift',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '6'),
    };
    const plan = await planTwoSignature(w.deps, stored, await loadSigners(w.deps), 1);
    const record = {
      paymentId: plan.paymentId,
      attempt: 1,
      at: '2026-11-10T10:00:00.000Z',
      hash: plan.hash,
      txBlob: plan.txBlob,
      lastLedgerSequence: plan.lastLedgerSequence,
    };
    await w.journal.append({ ...record, state: 'prepared' });
    await w.journal.append({ ...record, state: 'submitting' });
    const before = w.ledger.submitted.length;
    await expect(
      sendTwoSignatureTransfer(w.deps, { ...stored, amount: testTokenAmount(a.issuer, '7') }),
    ).rejects.toThrow(PaymentError);
    expect(w.ledger.submitted.length).toBe(before);
  });

  it('does not start an attempt beyond the limit after a restart', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const at = '2026-11-10T10:00:00.000Z';
    const entry = (attempt: number, state: JournalState) => ({
      paymentId: 'pay.limit',
      attempt,
      state,
      at,
    });
    for (const attempt of [1, 2]) {
      await w.journal.append(entry(attempt, 'prepared'));
      await w.journal.append(entry(attempt, 'submitting'));
      await w.journal.append(entry(attempt, 'expired'));
    }
    const before = w.ledger.submitted.length;
    const outcome = await sendTwoSignatureTransfer(
      { ...w.deps, maxAttempts: 2 },
      {
        paymentId: 'pay.limit',
        from: a.spending,
        to: a.supplier,
        amount: testTokenAmount(a.issuer, '2'),
      },
    );
    expect(outcome.decision).toEqual({ kind: 'expired' });
    expect(outcome.attempts).toBe(2);
    expect(w.ledger.submitted.length).toBe(before);
  });

  it('refuses a new attempt for a settled payment at the reliable layer as well', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'pay.layer',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '10'),
    };
    await sendTwoSignatureTransfer(w.deps, transfer);
    const before = w.ledger.submitted.length;
    const plan = await planTwoSignature(w.deps, transfer, await loadSigners(w.deps), 1);
    await expect(sendAndReconcile(plan, w.deps)).rejects.toThrow(JournalError);
    expect(w.ledger.submitted.length).toBe(before);
  });

  it('does not run the failover drill twice for the same payment', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const secondary = createXrplPort(
      new FakeClient(w.ledger) as unknown as Client,
      'wss://testnet.xrpl-labs.com',
    );
    const transfer: Transfer = {
      paymentId: 'failover.again',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '3'),
    };
    const first = await failoverDrill(w.deps, transfer, secondary);
    expect(first.decision.kind).toBe('paid');
    const before = w.ledger.submitted.length;
    await expect(failoverDrill(w.deps, transfer, secondary)).rejects.toThrow(JournalError);
    expect(w.ledger.submitted.length).toBe(before);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('3');
  });

  it('does not run the timeout drill twice for the same payment', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'timeout.again',
      from: a.spending,
      to: a.supplier,
      amount: testTokenAmount(a.issuer, '4'),
    };
    const first = await timeoutDrill(w.deps, transfer);
    expect(first.decision.kind).toBe('paid');
    const before = w.ledger.submitted.length;
    await expect(timeoutDrill(w.deps, transfer)).rejects.toThrow(JournalError);
    expect(w.ledger.submitted.length).toBe(before);
    expect(testTokenBalance(w, a.supplier, a.issuer)).toBe('4');
  });

  it('returns the recorded result for a repeated XRP payment and sends nothing', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const transfer: Transfer = {
      paymentId: 'pay.xrp',
      from: a.spending,
      to: a.supplier,
      amount: { kind: 'xrp', drops: '1000000' },
    };
    const first = await sendTwoSignatureTransfer(w.deps, transfer);
    expect(first.decision.kind).toBe('paid');
    const before = w.ledger.submitted.length;
    expect(await sendTwoSignatureTransfer(w.deps, transfer)).toEqual(first);
    expect(w.ledger.submitted.length).toBe(before);
  });

  it('reports a settled failure, rejection or hold from the journal, and sends nothing', async () => {
    const w = world();
    await ready(w);
    const a = accounts(w);
    const signers = await loadSigners(w.deps);
    const cases: {
      paymentId: string;
      state: JournalState;
      extra: Partial<JournalRecord>;
      decision: Decision;
    }[] = [
      {
        paymentId: 'settled.failed',
        state: 'failed',
        extra: { engineResult: 'tecPATH_DRY', ledgerIndex: 7 },
        decision: { kind: 'failed', engineResult: 'tecPATH_DRY', ledgerIndex: 7 },
      },
      {
        paymentId: 'settled.rejected',
        state: 'rejected',
        extra: { engineResult: 'tefBAD_QUORUM' },
        decision: { kind: 'rejected', engineResult: 'tefBAD_QUORUM' },
      },
      {
        paymentId: 'settled.held',
        state: 'held',
        extra: { reason: 'delivered-mismatch' },
        decision: { kind: 'hold', reason: 'delivered-mismatch' },
      },
    ];
    for (const { paymentId, state, extra, decision } of cases) {
      const transfer: Transfer = {
        paymentId,
        from: a.spending,
        to: a.supplier,
        amount: testTokenAmount(a.issuer, '1'),
      };
      const plan = await planTwoSignature(w.deps, transfer, signers, 1);
      const stored = {
        paymentId,
        attempt: 1,
        at: '2026-11-10T10:00:00.000Z',
        hash: plan.hash,
        txBlob: plan.txBlob,
        lastLedgerSequence: plan.lastLedgerSequence,
      };
      await w.journal.append({ ...stored, state: 'prepared' });
      await w.journal.append({ ...stored, state: 'submitting' });
      await w.journal.append({ ...stored, state, ...extra });
      const before = w.ledger.submitted.length;
      const outcome = await sendTwoSignatureTransfer(w.deps, transfer);
      expect(outcome.decision).toEqual(decision);
      expect(w.ledger.submitted.length).toBe(before);
    }
  });
});
