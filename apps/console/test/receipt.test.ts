import { describe, expect, it } from 'vitest';

import type { LedgerLookup } from '../../../packages/xrpl/src/reconcile.js';
import {
  assetLabelOf,
  receiptOf,
  type ReceiptConfig,
  type ReceiptLedger,
  type ReceiptPayment,
  type ReceiptView,
  TESTNET_EXPLORER,
} from '../src/server/receipt.js';

const ISSUER = 'rTokenIssuerForTests0000000';
const HASH = 'F'.repeat(64);
const CONFIG: ReceiptConfig = {
  tokenIssuer: ISSUER,
  rlusdIssuer: null,
  explorerBase: TESTNET_EXPLORER,
  demoRandPerUnit: '18.50',
};
const PAID: ReceiptPayment = {
  status: 'paid',
  currency: 'USD',
  ledgerCurrency: 'TST',
  amountMinor: 125000,
  transactionHash: HASH,
};

function validated(value: string, currency = 'TST', issuer = ISSUER): LedgerLookup {
  return {
    status: 'validated',
    engineResult: 'tesSUCCESS',
    ledgerIndex: 99,
    delivered: { kind: 'iou', amount: { currency, issuer, value } },
  };
}

/** A ledger that answers with the given lookup, or fails, and counts its calls. */
function ledgerAnswering(answer: LedgerLookup | Error): ReceiptLedger & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    lookup: () => {
      calls += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

function receipt(overrides: {
  readonly payment?: ReceiptPayment | null;
  readonly displayState?: 'Paid' | 'Held';
  readonly ledger?: ReceiptLedger | null;
  readonly config?: ReceiptConfig;
}) {
  return receiptOf({
    displayState: overrides.displayState ?? 'Paid',
    invoiceRef: 'aaaaaaaa',
    payment: overrides.payment === undefined ? PAID : overrides.payment,
    ledger:
      overrides.ledger === undefined ? ledgerAnswering(validated('1250.00')) : overrides.ledger,
    config: overrides.config ?? CONFIG,
  });
}

/** The message of a receipt that is not given. A receipt that is given has none. */
function messageOf(view: ReceiptView): string {
  return view.state === 'receipt' ? '' : view.message;
}

describe('the receipt', () => {
  it('is given only for a payment the desk says is paid, and asks the ledger only then', async () => {
    const ledger = ledgerAnswering(validated('1250.00'));
    const held = await receipt({ displayState: 'Held', ledger });
    expect(held.state).toBe('not-paid');
    expect(ledger.calls).toBe(0);
  });

  it('shows a receipt when the ledger validated a success that delivered the settled amount', async () => {
    const view = await receipt({});
    expect(view).toMatchObject({
      state: 'receipt',
      invoiceRef: 'aaaaaaaa',
      amount: '1250.00',
      currency: 'USD',
      asset: 'test-issued token, not RLUSD',
      deliveredValue: '1250.00',
      ledgerIndex: 99,
      explorerUrl: `${TESTNET_EXPLORER}${HASH}`,
    });
  });

  it('builds the explorer link only from a full 64-character hexadecimal hash', async () => {
    for (const hash of ['F'.repeat(63), `${'F'.repeat(63)}G`, 'F'.repeat(65)]) {
      const view = await receipt({ payment: { ...PAID, transactionHash: hash } });
      expect(view).toMatchObject({ state: 'not-confirmed' });
    }
    const missing = await receipt({ payment: { ...PAID, transactionHash: null } });
    expect(messageOf(missing)).toContain('no full transaction hash');
  });

  it('gives a rand figure labelled SIMULATED, and none when no placeholder rate is set', async () => {
    const view = await receipt({});
    expect(view.state === 'receipt' ? view.rand : null).toEqual({
      label: 'SIMULATED',
      amount: (1250 * 18.5).toFixed(2),
      rate: '18.50',
    });
    const noRate = await receipt({ config: { ...CONFIG, demoRandPerUnit: null } });
    expect(noRate.state === 'receipt' ? noRate.rand : 'no receipt').toBeNull();
  });

  it('says Not confirmed on the ledger when the delivered amount differs from the settled record', async () => {
    const view = await receipt({ ledger: ledgerAnswering(validated('1249.99')) });
    expect(view).toEqual({
      state: 'not-confirmed',
      message:
        'Not confirmed on the ledger: the delivered amount does not match the settled record.',
    });
  });

  it('says Not confirmed when the delivered amount is in another currency or from another issuer', async () => {
    const otherCurrency = await receipt({ ledger: ledgerAnswering(validated('1250.00', 'OTHER')) });
    const otherIssuer = await receipt({
      ledger: ledgerAnswering(validated('1250.00', 'TST', 'rSomeoneElse000000000000000')),
    });
    expect(otherCurrency.state).toBe('not-confirmed');
    expect(otherIssuer.state).toBe('not-confirmed');
  });

  it('says Not confirmed on the ledger when the ledger cannot be read', async () => {
    const view = await receipt({ ledger: ledgerAnswering(new Error('connection refused')) });
    expect(view).toEqual({
      state: 'not-confirmed',
      message: 'Not confirmed on the ledger: the ledger could not be read.',
    });
  });

  it('says Not confirmed when the transaction is not validated yet, or the ledger result is not a success', async () => {
    const pending = await receipt({ ledger: ledgerAnswering({ status: 'not-validated' }) });
    expect(messageOf(pending)).toContain('not validated yet');
    const failed = await receipt({
      ledger: ledgerAnswering({
        status: 'validated',
        engineResult: 'tecPATH_DRY',
        ledgerIndex: 99,
        delivered: { kind: 'unknown' },
      }),
    });
    expect(messageOf(failed)).toContain('the ledger result is tecPATH_DRY');
  });

  it('says Not confirmed when no ledger, no token issuer, or no currency code is configured', async () => {
    expect(messageOf(await receipt({ ledger: null }))).toContain('no ledger is configured');
    expect(messageOf(await receipt({ config: { ...CONFIG, tokenIssuer: null } }))).toContain(
      'the token issuer is not configured',
    );
    expect(messageOf(await receipt({ payment: { ...PAID, ledgerCurrency: undefined } }))).toContain(
      'the currency of this payment is not recognised',
    );
  });
});

describe('the asset name', () => {
  it('names the asset the test token unless the RLUSD issuer is configured and is the token issuer', () => {
    expect(assetLabelOf(CONFIG, 'RLUSD')).toBe('test-issued token, not RLUSD');
    expect(assetLabelOf({ ...CONFIG, rlusdIssuer: 'rSomeoneElse000000000000000' }, 'RLUSD')).toBe(
      'test-issued token, not RLUSD',
    );
    expect(assetLabelOf({ ...CONFIG, rlusdIssuer: ISSUER }, 'RLUSD')).toBe('RLUSD');
    expect(assetLabelOf({ ...CONFIG, rlusdIssuer: ISSUER }, 'TST')).toBe(
      'test-issued token, not RLUSD',
    );
  });
});
