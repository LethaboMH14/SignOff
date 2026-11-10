import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ReceiptView as ReceiptData } from '../src/server/receipt.js';
import { ReceiptView } from '../web/ReceiptView.js';

const NO_OP = (): void => undefined;
const CONFIRMED: ReceiptData = {
  state: 'receipt',
  invoiceRef: 'aaaaaaaa',
  amount: '1250.00',
  currency: 'USD',
  asset: 'test-issued token, not RLUSD',
  deliveredValue: '1250.00',
  ledgerIndex: 99,
  explorerUrl: `https://testnet.xrpl.org/transactions/${'F'.repeat(64)}`,
  rand: { label: 'SIMULATED', amount: '23125.00', rate: '18.50' },
};

function viewOf(receipt: ReceiptData | null, error: string | null = null): string {
  return renderToStaticMarkup(<ReceiptView receipt={receipt} error={error} onBack={NO_OP} />);
}

describe('the receipt screen', () => {
  it('links the explorer, names the asset, and shows the amount the ledger delivered', () => {
    const markup = viewOf(CONFIRMED);
    expect(markup).toContain(`href="https://testnet.xrpl.org/transactions/${'F'.repeat(64)}"`);
    expect(markup).toContain('test-issued token, not RLUSD');
    expect(markup).toContain('1250.00');
    expect(markup).toContain('Validated on the ledger and reconciled.');
  });

  it('labels the rand figure SIMULATED, with its placeholder rate, and says no market rate is claimed', () => {
    const markup = viewOf(CONFIRMED);
    expect(markup).toContain('<strong>SIMULATED</strong>');
    expect(markup).toContain('R23125.00');
    expect(markup).toContain('placeholder rate');
    expect(markup).toContain('No market rate is claimed.');
  });

  it('shows no rand figure when none is configured', () => {
    const markup = viewOf({ ...CONFIRMED, rand: null });
    expect(markup).not.toContain('SIMULATED');
    expect(markup).not.toContain('R23125.00');
  });

  it('shows no receipt, and no explorer link, when the ledger does not confirm the payment', () => {
    const markup = viewOf({
      state: 'not-confirmed',
      message: 'Not confirmed on the ledger: the ledger could not be read.',
    });
    expect(markup).toContain('No receipt yet');
    expect(markup).toContain('Not confirmed on the ledger: the ledger could not be read.');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('chip-paid');
  });

  it('shows a loading line until the receipt arrives, and the error when it does not', () => {
    expect(viewOf(null)).toContain('Checking the ledger…');
    expect(viewOf(null, 'no such payment')).toContain('no such payment');
    expect(viewOf(null, 'no such payment')).not.toContain('Checking the ledger…');
  });
});
