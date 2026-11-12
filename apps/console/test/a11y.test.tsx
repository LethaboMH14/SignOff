import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DeskData, PendingAction, PendingRaise } from '../web/api.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';
import type { ReceiptView as ReceiptData } from '../src/server/receipt.js';
import { DeskView } from '../web/DeskView.js';
import { InvoiceView } from '../web/InvoiceView.js';
import { Login } from '../web/Login.js';
import { ReceiptView } from '../web/ReceiptView.js';
import { DISPLAY_STATES } from '../src/model/desk.js';

/*
 * The four screens, checked with axe-core in a DOM (jsdom). Colour contrast is switched off here, because jsdom does not
 * lay out a page; it is checked in the browser instead (see the layout check in the test log). Only serious and
 * critical problems fail the check.
 */

const require = createRequire(import.meta.url);
// The path is the installed axe-core package's own script, resolved by the module system; nothing user-supplied.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the installed axe-core script, resolved by the module system
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const NO_OP = (): void => undefined;
const NO_OP_ASYNC = (): Promise<void> => Promise.resolve();

interface AxeResult {
  readonly violations: readonly {
    readonly id: string;
    readonly impact: string | null;
    readonly help: string;
  }[];
}
interface AxeWindow {
  readonly axe: { run(context: unknown, options: unknown): Promise<AxeResult> };
}

function pageOf(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SignOff operator console</title></head><body>${body}</body></html>`;
}

/** The serious and critical problems axe-core finds on a page, as text. An empty list passes. */
async function seriousProblemsOf(body: string): Promise<string[]> {
  const dom = new JSDOM(pageOf(body), { runScripts: 'outside-only' });
  dom.window.eval(AXE_SOURCE);
  const axe = (dom.window as unknown as AxeWindow).axe;
  const result = await axe.run(dom.window.document, {
    rules: { 'color-contrast': { enabled: false } },
  });
  dom.window.close();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.help}`);
}

function countsOf(): DeskData['counts'] {
  return Object.fromEntries(DISPLAY_STATES.map((state) => [state, 0])) as DeskData['counts'];
}

const DESK: DeskData = {
  asOf: '2026-11-11T09:00:00.000Z',
  mode: 'simulated',
  damagedLines: 0,
  overview: {
    paused: false,
    policyVersion: '2026-11-10.1',
    limits: { perPaymentMinor: 500000, supplierDailyMinor: 1000000, dailyTotalMinor: 2000000 },
    usageToday: { day: '2026-11-11', totalMinor: 120000 },
    pendingLimitChange: null,
  },
  counts: { ...countsOf(), Paid: 1, Held: 1 },
  rows: [
    {
      rowId: 'a'.repeat(36),
      invoiceRef: 'aaaaaaaa',
      attemptId: 'a'.repeat(36),
      supplierId: 'SUP-ABCD1234',
      amountMinor: 125000,
      currency: 'USD',
      displayState: 'Paid',
      reasonCode: 'OK',
      reason: 'No problem found at this step.',
      modelCalls: 2,
      updatedAt: '2026-11-11T09:00:00.000Z',
    },
    {
      rowId: 'b'.repeat(64),
      invoiceRef: 'bbbbbbbb',
      attemptId: null,
      supplierId: null,
      amountMinor: null,
      currency: null,
      displayState: 'Held',
      reasonCode: 'MISSING_EVIDENCE',
      reason: 'A record needed to check the invoice is missing.',
      modelCalls: null,
      updatedAt: '2026-11-11T08:00:00.000Z',
    },
  ],
};

const RAISE: PendingRaise = {
  requestId: 'c'.repeat(8),
  requestedBy: 'alice',
  expiresAt: '2026-11-12T08:00:00.000Z',
  perPaymentMinor: 900000,
  supplierDailyMinor: 1000000,
  dailyTotalMinor: 2000000,
  approvalAllowed: true,
  why: 'A second operator approves this raise. Approval needs your password.',
};

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
  enrolledPayee: '…WXYZ',
  payoutChange: {
    status: 'requested',
    coolingOffUntil: null,
    approvalAllowed: false,
    why: 'A payout change is approved by a second operator in the Warden. The console does not approve payout changes.',
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

const RECEIPT: ReceiptData = {
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

function deskWith(data: DeskData, pending: PendingAction | null = null): string {
  return renderToStaticMarkup(
    <DeskView
      data={data}
      error={null}
      busy={false}
      pending={pending}
      onTogglePause={NO_OP}
      onRequestLimits={NO_OP}
      onApprove={NO_OP}
      onConfirm={NO_OP_ASYNC}
      onCancelConfirm={NO_OP}
      onOpen={NO_OP}
      onReceipt={NO_OP}
    />,
  );
}

describe('the screens, checked with axe-core', () => {
  it('the sign-in screen has no serious or critical problem', async () => {
    expect(await seriousProblemsOf(renderToStaticMarkup(<Login onSignedIn={NO_OP} />))).toEqual([]);
  });

  it('the payment desk has no serious or critical problem', async () => {
    expect(await seriousProblemsOf(deskWith(DESK))).toEqual([]);
  });

  it('the payment desk with a waiting raise and the password prompt has no serious or critical problem', async () => {
    const withRaise: DeskData = {
      ...DESK,
      overview: { ...DESK.overview, pendingLimitChange: RAISE },
    };
    expect(await seriousProblemsOf(deskWith(withRaise, { kind: 'pause', paused: true }))).toEqual(
      [],
    );
  });

  it('the held-invoice screen has no serious or critical problem', async () => {
    const body = renderToStaticMarkup(<InvoiceView detail={HELD} error={null} onBack={NO_OP} />);
    expect(await seriousProblemsOf(body)).toEqual([]);
  });

  it('the receipt screen has no serious or critical problem', async () => {
    const body = renderToStaticMarkup(
      <ReceiptView receipt={RECEIPT} error={null} onBack={NO_OP} />,
    );
    expect(await seriousProblemsOf(body)).toEqual([]);
  });
});

describe('the keyboard', () => {
  it('reaches every control on the held-invoice screen, each with a name, starting with going back', () => {
    const body = renderToStaticMarkup(<InvoiceView detail={HELD} error={null} onBack={NO_OP} />);
    const dom = new JSDOM(pageOf(body));
    const controls = [
      ...dom.window.document.querySelectorAll('button, a[href], input, select, textarea'),
    ];
    const names = controls.map((control) => {
      const text = control.textContent.trim();
      return text === '' ? (control.getAttribute('aria-label') ?? '') : text;
    });
    dom.window.close();
    expect(names[0]).toBe('Back to the queue');
    expect(names.length).toBeGreaterThan(1);
    expect(names.every((name) => name.length > 0)).toBe(true);
  });

  it('never gives a control a positive tab index, which would change the reading order', () => {
    const body = renderToStaticMarkup(
      <DeskView
        data={DESK}
        error={null}
        busy={false}
        pending={null}
        onTogglePause={NO_OP}
        onRequestLimits={NO_OP}
        onApprove={NO_OP}
        onConfirm={NO_OP_ASYNC}
        onCancelConfirm={NO_OP}
        onOpen={NO_OP}
        onReceipt={NO_OP}
      />,
    );
    const dom = new JSDOM(pageOf(body));
    const positive = [...dom.window.document.querySelectorAll('[tabindex]')].filter(
      (element) => Number(element.getAttribute('tabindex')) > 0,
    );
    dom.window.close();
    expect(positive).toEqual([]);
  });
});
