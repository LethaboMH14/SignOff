import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type DeskData, type PendingAction, type PendingRaise } from '../web/api.js';
import {
  countOf,
  DeskView,
  HEADLINE_STATES,
  majorTextOf,
  minorOf,
  moneyOf,
  sastOf,
  shortSastOf,
  tabAfter,
} from '../web/DeskView.js';
import { Login } from '../web/Login.js';
import { slugOf, StateChip, symbolOf } from '../web/StateChip.js';
import { DISPLAY_STATES } from '../src/model/desk.js';

function counts(overrides: Partial<Record<(typeof DISPLAY_STATES)[number], number>> = {}) {
  return Object.fromEntries(
    DISPLAY_STATES.map((state) => [state, new Map(Object.entries(overrides)).get(state) ?? 0]),
  ) as DeskData['counts'];
}

function dataOf(overrides: Partial<DeskData> = {}): DeskData {
  return {
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
    counts: counts({ Paid: 1, Held: 1 }),
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
    ...overrides,
  };
}

function raiseOf(overrides: Partial<PendingRaise> = {}): PendingRaise {
  return {
    requestId: 'c'.repeat(8),
    requestedBy: 'alice',
    expiresAt: '2026-11-12T08:00:00.000Z',
    perPaymentMinor: 900000,
    supplierDailyMinor: 1000000,
    dailyTotalMinor: 2000000,
    approvalAllowed: true,
    why: 'A second operator approves this raise. Approval needs your password.',
    ...overrides,
  };
}

const NO_OP = (): void => undefined;
const NO_OP_ASYNC = (): Promise<void> => Promise.resolve();
const PAUSE: PendingAction = { kind: 'pause', paused: true };

function deskOf(
  data: DeskData | null,
  pending: PendingAction | null = null,
  error: string | null = null,
): string {
  return renderToStaticMarkup(
    <DeskView
      data={data}
      error={error}
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

describe('the state chips', () => {
  it('give every state its words, and hide the symbol from assistive technology', () => {
    for (const state of DISPLAY_STATES) {
      const markup = renderToStaticMarkup(<StateChip state={state} />);
      expect(markup).toContain(`>${symbolOf(state)}</span> ${state}`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain(`chip-${slugOf(state)}`);
    }
  });

  it('give every headline state a symbol and a class', () => {
    for (const state of HEADLINE_STATES) {
      expect(symbolOf(state).length).toBeGreaterThan(0);
    }
  });
});

describe('the desk', () => {
  it('says whether payments are running or paused, in words', () => {
    expect(deskOf(dataOf())).toContain('Payments are running.');
    expect(deskOf(dataOf({ overview: { ...dataOf().overview, paused: true } }))).toContain(
      'Payments are paused.',
    );
  });

  it('marks simulated data as SIMULATED, and never calls it a live run', () => {
    const simulated = deskOf(dataOf());
    expect(simulated).toContain('SIMULATED: replay of a labelled run.');
    expect(simulated).not.toContain('Live run on Testnet');
    expect(deskOf(dataOf({ mode: 'live' }))).toContain('Live run on Testnet');
    expect(deskOf(dataOf({ mode: 'live' }))).not.toContain('Test-issued token');
  });

  it('shows Paid only on the row that is Paid, and the reason words for the held row', () => {
    const markup = deskOf(dataOf());
    const queue = markup.slice(markup.indexOf('id="invoice-history"'));
    expect(queue.split('chip-paid').length - 1).toBe(1);
    expect(queue.split('chip-held').length - 1).toBe(1);
    expect(queue).toContain('Model calls: 2 of at most 3');
    expect(queue).toContain('aria-label="Open invoice aaaaaaaa"');
    expect(queue).toContain('aria-label="Open receipt for invoice aaaaaaaa"');
    expect(queue).not.toContain('aria-label="Open receipt for invoice bbbbbbbb"');
    expect(markup).toContain('A record needed to check the invoice is missing.');
    expect(markup).toContain('<code>MISSING_EVIDENCE</code>');
    expect(markup).toContain('Amount not recorded');
  });

  it('shows the amount with its currency, from the row', () => {
    expect(deskOf(dataOf())).toContain('1,250.00 USD');
  });

  it('shows an empty queue as empty, and a loading desk as loading', () => {
    expect(deskOf(dataOf({ rows: [] }))).toContain('Nothing has been proposed or held yet.');
    expect(deskOf(null)).toContain('Loading the desk…');
    expect(deskOf(null, null, 'The desk did not load. Try again.')).toContain(
      'The desk did not load. Try again.',
    );
  });

  it('asks for the password before a change, and says what it is for', () => {
    const markup = deskOf(dataOf(), PAUSE);
    expect(markup).toContain('aria-label="Confirm your password"');
    expect(markup).toContain('Confirm your password to make this change.');
    expect(deskOf(dataOf())).not.toContain('Confirm your password to make this change.');
  });

  it('offers the limits form, with the current limits as amounts to type', () => {
    const markup = deskOf(dataOf());
    expect(markup).toContain('aria-label="Change limits"');
    expect(markup).toContain('Per payment');
    expect(markup).toContain('value="5000.00"');
    expect(markup).toContain('value="20000.00"');
  });
});

describe('a raised limit waiting for a second operator', () => {
  it('names the requester and shows the approval, enabled for another operator', () => {
    const markup = deskOf(
      dataOf({ overview: { ...dataOf().overview, pendingLimitChange: raiseOf() } }),
    );
    expect(markup).toContain('A raised limit is waiting');
    expect(markup).toContain('Asked by');
    expect(markup).toContain('alice');
    expect(markup).toMatch(
      /<button type="button" aria-describedby="approve-why">Approve the raised limit<\/button>/,
    );
    expect(markup).toContain('A second operator approves this raise.');
  });

  it('disables the approval for the person who asked, and says why', () => {
    const markup = deskOf(
      dataOf({
        overview: {
          ...dataOf().overview,
          pendingLimitChange: raiseOf({
            requestedBy: 'you',
            approvalAllowed: false,
            why: 'You asked for this raise, so another operator must approve it.',
          }),
        },
      }),
    );
    expect(markup).toMatch(/disabled=""[^>]*>Approve the raised limit</);
    expect(markup).toContain('You asked for this raise, so another operator must approve it.');
  });
});

describe('formatting', () => {
  it('shows minor units with two decimals, and a time in South African time', () => {
    expect(moneyOf(5, null)).toBe('0.05');
    expect(moneyOf(125000, 'USD')).toBe('1,250.00 USD');
    expect(sastOf('not a time')).toBe('time not recorded');
    expect(sastOf('2026-11-11T09:00:00.000Z')).toContain('11:00');
  });

  it('reads an amount typed as 5000 or 5000.00 as minor units, and refuses anything else', () => {
    expect(minorOf('5000')).toBe(500000);
    expect(minorOf(' 5000.00 ')).toBe(500000);
    expect(minorOf('12.5')).toBe(1250);
    expect(minorOf('0')).toBeNull();
    expect(minorOf('12.345')).toBeNull();
    expect(minorOf('abc')).toBeNull();
    expect(majorTextOf(500000)).toBe('5000.00');
  });

  it('counts a missing state as zero', () => {
    expect(countOf(counts({ Paid: 3 }), 'Paid')).toBe(3);
    expect(countOf(counts(), 'Held')).toBe(0);
  });
});

describe('the desk tabs', () => {
  it('opens on the queue, and keeps the other two sections behind their tabs', () => {
    const markup = deskOf(dataOf({ mode: 'live' }));
    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/id="desk-tab-queue"[^>]*aria-selected="true"/);
    expect(markup).toMatch(/id="desk-tab-invoices"[^>]*aria-selected="false"/);
    expect(markup).toMatch(/id="desk-tab-warden"[^>]*aria-selected="false"/);
    expect(markup).not.toMatch(/id="desk-panel-queue"[^>]*hidden/);
    expect(markup).toMatch(/id="desk-panel-invoices"[^>]*hidden=""/);
    expect(markup).toMatch(/id="desk-panel-warden"[^>]*hidden=""/);
  });

  it('keeps the counts above the tabs, so they stay in view on every tab', () => {
    const markup = deskOf(dataOf({ mode: 'live' }));
    expect(markup.indexOf('aria-label="Counts by state"')).toBeLessThan(
      markup.indexOf('role="tablist"'),
    );
  });

  it('shows the count of invoices that need a person on the Queue tab, and the invoice count on Invoices', () => {
    const markup = deskOf(dataOf({ mode: 'live' }));
    expect(markup).toMatch(/id="desk-tab-queue"[\s\S]*?desk-tab-count">1</);
    expect(markup).toMatch(/id="desk-tab-invoices"[\s\S]*?desk-tab-count">2</);
  });

  it('keeps the invoice history in the Invoices tab, and does not list the invoices a second time', () => {
    const markup = deskOf(dataOf({ mode: 'live' }));
    expect(markup).toMatch(/id="desk-panel-invoices"[^>]*hidden=""[\s\S]*id="invoice-history"/);
    expect(markup).not.toContain('All invoices');
  });

  it('puts the password sheet at the top of the Warden tab, beside the change it confirms', () => {
    const markup = deskOf(dataOf({ mode: 'live' }), PAUSE);
    const sheet = markup.indexOf('aria-label="Confirm your password"');
    expect(sheet).toBeGreaterThan(markup.indexOf('id="desk-panel-warden"'));
    expect(sheet).toBeLessThan(markup.indexOf('class="control-layout"'));
  });
});

describe('moving between the desk tabs with the keyboard', () => {
  it('moves one tab on with the arrows, wrapping at the ends, and Home and End go to the first and last', () => {
    expect(tabAfter('queue', 'ArrowRight')).toBe('invoices');
    expect(tabAfter('invoices', 'ArrowRight')).toBe('warden');
    expect(tabAfter('warden', 'ArrowRight')).toBe('queue');
    expect(tabAfter('queue', 'ArrowLeft')).toBe('warden');
    expect(tabAfter('warden', 'Home')).toBe('queue');
    expect(tabAfter('queue', 'End')).toBe('warden');
  });

  it('moves nothing for any other key', () => {
    expect(tabAfter('queue', 'Enter')).toBeNull();
    expect(tabAfter('invoices', 'a')).toBeNull();
  });
});

describe('the short time on a history card', () => {
  it('shows the day, month and clock in South African time, with no year', () => {
    const text = shortSastOf('2026-11-13T00:35:00.000Z');
    expect(text).toContain('02:35');
    expect(text).toContain('13');
    expect(text).not.toContain('2026');
  });

  it('says the time is not recorded when the stamp cannot be read', () => {
    expect(shortSastOf('not a time')).toBe('time not recorded');
  });
});

describe('the sign-in form', () => {
  it('names the fields and keeps the refusal message in an alert', () => {
    const markup = renderToStaticMarkup(<Login onSignedIn={NO_OP} />);
    expect(markup).toContain('name="username"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toContain('role="alert"');
  });
});

describe('the test invoice panel', () => {
  const send = (): Promise<string> => Promise.resolve('sent');
  const withSender = (data: DeskData): string =>
    renderToStaticMarkup(
      <DeskView
        data={data}
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
        onSendTestInvoice={send}
      />,
    );

  it('shows when the console says test invoices are on', () => {
    const markup = withSender(dataOf({ testInvoices: true }));
    expect(markup).toContain('Send a test invoice');
    expect(markup).toContain('Testnet demo');
  });

  it('stays hidden when the console has them off, or for a desk with no sender', () => {
    expect(withSender(dataOf({ testInvoices: false }))).not.toContain('Send a test invoice');
    expect(deskOf(dataOf({ testInvoices: true }))).not.toContain('Send a test invoice');
  });
});
