import { describe, expect, it } from 'vitest';
import { Wallet, type Client } from 'xrpl';
import { FakeClient, FakeLedger } from './helpers/fake-ledger.js';
import { createXrplPort } from '../src/xrpl-port.js';
import {
  describeDecision,
  LedgerStepError,
  sendSingleSigned,
  type LedgerDeps,
} from '../src/single.js';
import {
  deliveredBalance,
  PaymentError,
  planTwoSignature,
  sameBalance,
  type PaymentDeps,
  type Transfer,
} from '../src/payments.js';
import { memoryJournalStore } from '../src/store.js';
import type { LedgerPort } from '../src/port.js';
import { buildXrpPayment } from '../src/transactions.js';
import type { Decision } from '../src/reconcile.js';

function ledgerPort(): { ledger: FakeLedger; port: LedgerPort } {
  const ledger = new FakeLedger();
  const port = createXrplPort(
    new FakeClient(ledger) as unknown as Client,
    'wss://s.altnet.rippletest.net:51233',
  );
  return { ledger, port };
}

/** The same port, with autofill that leaves LastLedgerSequence out, so the expiry guard has to refuse. */
function portWithoutExpiry(port: LedgerPort): LedgerPort {
  return {
    ...port,
    autofill: async (transaction) => {
      const prepared = await port.autofill(transaction, 0);
      const withoutExpiry = { ...prepared };
      delete withoutExpiry.LastLedgerSequence;
      return withoutExpiry;
    },
  };
}

describe('describeDecision', () => {
  it('describes every outcome without addresses', () => {
    const cases: [Decision, string][] = [
      [{ kind: 'paid', ledgerIndex: 42 }, 'validated in ledger 42'],
      [
        { kind: 'failed', engineResult: 'tecPATH_DRY', ledgerIndex: 7 },
        'validated with tecPATH_DRY',
      ],
      [{ kind: 'hold', reason: 'delivered-mismatch' }, 'held (delivered-mismatch)'],
      [{ kind: 'expired' }, 'expired before validation'],
      [{ kind: 'rejected', engineResult: 'tefBAD_QUORUM' }, 'rejected (tefBAD_QUORUM)'],
      [{ kind: 'wait' }, 'not decided within the poll budget'],
    ];
    for (const [decision, text] of cases) {
      expect(describeDecision(decision)).toBe(text);
    }
  });
});

describe('a step needs an expiry window', () => {
  it('refuses to send a transaction whose autofill set no LastLedgerSequence', async () => {
    const { ledger, port } = ledgerPort();
    const wallet = Wallet.generate();
    const destination = Wallet.generate();
    ledger.fund(wallet);
    ledger.fund(destination);
    const withoutWindow = portWithoutExpiry(port);
    const deps: LedgerDeps = {
      port: withoutWindow,
      journal: memoryJournalStore(),
      now: () => new Date(),
      sleep: () => Promise.resolve(),
      pollMs: 0,
      maxPolls: 1,
      newId: () => 'x',
    };
    await expect(
      sendSingleSigned(
        deps,
        wallet,
        buildXrpPayment(wallet.address, destination.address, '1'),
        'window',
      ),
    ).rejects.toThrow(LedgerStepError);
  });

  it('refuses to plan a two-signature payment without an expiry window', async () => {
    const { ledger, port } = ledgerPort();
    const sender = Wallet.generate();
    const destination = Wallet.generate();
    ledger.fund(sender);
    ledger.fund(destination);
    const withoutWindow = portWithoutExpiry(port);
    const transfer: Transfer = {
      paymentId: 'window',
      from: {
        role: 'spending',
        address: sender.address,
        status: 'active',
        createdAt: '2026-11-10T10:00:00.000Z',
      },
      to: {
        role: 'supplier',
        address: destination.address,
        status: 'active',
        createdAt: '2026-11-10T10:00:00.000Z',
      },
      amount: { kind: 'xrp', drops: '1000' },
    };
    const agent = {
      role: 'agent' as const,
      address: Wallet.generate().address,
      status: 'active' as const,
      createdAt: '2026-11-10T10:00:00.000Z',
    };
    const warden = {
      role: 'warden' as const,
      address: Wallet.generate().address,
      status: 'active' as const,
      createdAt: '2026-11-10T10:00:00.000Z',
    };
    const deps = {
      port: withoutWindow,
      journal: memoryJournalStore(),
      now: () => new Date(),
      sleep: () => Promise.resolve(),
      pollMs: 0,
      maxPolls: 1,
      newId: () => 'x',
    } as LedgerDeps;
    await expect(planTwoSignature(deps, transfer, { agent, warden }, 1)).rejects.toThrow(
      PaymentError,
    );
  });
});

describe('balances used by the checks', () => {
  it('reads an XRP balance in drops, a missing token line as zero, and compares balances exactly', async () => {
    const { ledger, port } = ledgerPort();
    const holder = Wallet.generate();
    const issuer = Wallet.generate();
    ledger.fund(holder);
    ledger.fund(issuer);
    const account = {
      role: 'supplier' as const,
      address: holder.address,
      status: 'active' as const,
      createdAt: '2026-11-10T10:00:00.000Z',
    };
    expect(await deliveredBalance(port, account, { kind: 'xrp', drops: '1' })).toBe('100000000');
    expect(
      await deliveredBalance(port, account, {
        kind: 'iou',
        amount: { currency: 'TST', issuer: issuer.address, value: '1' },
      }),
    ).toBe('0');
    expect(sameBalance('5', '5.0')).toBe(true);
    expect(sameBalance('5', '6')).toBe(false);
  });

  it('reads zero for an XRP balance of an account that is not on the ledger', async () => {
    const { port } = ledgerPort();
    const ghost = Wallet.generate();
    const account = {
      role: 'supplier' as const,
      address: ghost.address,
      status: 'active' as const,
      createdAt: '2026-11-10T10:00:00.000Z',
    };
    expect(await deliveredBalance(port, account, { kind: 'xrp', drops: '1' })).toBe('0');
  });
});

describe('the payment deps type is structural', () => {
  it('accepts the payment deps the flows use', () => {
    const deps: PaymentDeps = {
      port: ledgerPort().port,
      journal: memoryJournalStore(),
      registry: { read: () => Promise.resolve(null), write: () => Promise.resolve() },
      now: () => new Date(),
      sleep: () => Promise.resolve(),
      pollMs: 0,
      maxPolls: 1,
      newId: () => 'x',
      maxAttempts: 1,
      log: () => undefined,
    };
    expect(deps.maxAttempts).toBe(1);
  });
});
