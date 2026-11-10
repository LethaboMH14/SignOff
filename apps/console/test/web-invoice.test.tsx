import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoiceView, shortHashOf } from '../web/InvoiceView.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';

const NO_OP = (): void => undefined;

const HELD: InvoiceDetail = {
  invoiceRef: 'bbbbbbbb',
  attemptId: null,
  displayState: 'Held',
  supplierId: null,
  amountMinor: null,
  currency: null,
  failedRule: {
    code: 'MISSING_EVIDENCE',
    sentence: 'A record needed to check the invoice is missing.',
  },
  nextAction: 'Link the purchase order or goods receipt, then propose the invoice again.',
  enrolledPayee: null,
  payoutChange: {
    status: 'requested',
    coolingOffUntil: null,
    approvalAllowed: false,
    why: 'A payout change is approved by a second operator in the Warden, once it is confirmed and its cooling-off period has ended. The console does not approve payout changes.',
  },
  wardenDecision: null,
  history: [
    {
      seq: 3,
      at: '2026-11-11T09:03:00.000Z',
      actorLabel: 'Matcher',
      stateLabel: 'Held for a person',
      reasonCode: 'MISSING_EVIDENCE',
      reason: 'A record needed to check the invoice is missing.',
      policyVersion: '2026-11-10.1',
      fileSha256: 'e'.repeat(64),
      recordSha256s: ['1'.repeat(64)],
    },
  ],
};

function viewOf(detail: InvoiceDetail | null, error: string | null = null): string {
  return renderToStaticMarkup(<InvoiceView detail={detail} error={error} onBack={NO_OP} />);
}

describe('the held-invoice screen', () => {
  it('shows the state, the failed rule and the next step, in words', () => {
    const markup = viewOf(HELD);
    expect(markup).toContain('bbbbbbbb');
    expect(markup).toContain('<code>MISSING_EVIDENCE</code>');
    expect(markup).toContain('A record needed to check the invoice is missing.');
    expect(markup).toContain(
      'Link the purchase order or goods receipt, then propose the invoice again.',
    );
  });

  it('never shows a held invoice as paid', () => {
    expect(viewOf(HELD)).not.toContain('chip-paid');
  });

  it('shows the payout approval as disabled, and says why', () => {
    const markup = viewOf(HELD);
    expect(markup).toMatch(/disabled=""[^>]*>Approve payout change</);
    expect(markup).toContain('Approval is not available in the console.');
    expect(markup).toContain('The console does not approve payout changes.');
  });

  it('lists the evidence path move by move, with short hashes and no document text', () => {
    const markup = viewOf(HELD);
    expect(markup).toContain('Held for a person');
    expect(markup).toContain('Matcher');
    expect(markup).toContain(`${'e'.repeat(12)}…`);
    expect(markup).toContain('records checked');
  });

  it('shows a loading line until the detail arrives, and an error when it does not', () => {
    expect(viewOf(null)).toContain('Loading the invoice…');
    expect(viewOf(null, 'no such invoice')).toContain('no such invoice');
    expect(viewOf(null, 'no such invoice')).not.toContain('Loading the invoice…');
  });

  it('says a hash was not recorded when there is none', () => {
    expect(shortHashOf(null)).toBe('not recorded');
    expect(shortHashOf('a'.repeat(64))).toBe(`${'a'.repeat(12)}…`);
  });
});
