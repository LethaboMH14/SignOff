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
    />,
  );
}

describe('the state chips', () => {
  it('give every state its words, and hide the symbol from assistive technology', () => {
    for (const state of DISPLAY_STATES) {
      const markup = renderToStaticMarkup(<StateChip state={state} />);
      expect(markup).toContain(`<span aria-hidden="true">${symbolOf(state)}</span> ${state}`);
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
  });

  it('shows Paid only on the row that is Paid, and the reason words for the held row', () => {
    const markup = deskOf(dataOf());
    const queue = markup.slice(markup.indexOf('class="queue"'));
    expect(queue.split('chip-paid').length - 1).toBe(1);
    expect(queue.split('chip-held').length - 1).toBe(1);
    expect(queue).toContain('Model calls: 2 of at most 3');
    expect(queue).toContain('aria-label="Open invoice aaaaaaaa"');
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

describe('the sign-in form', () => {
  it('names the fields and keeps the refusal message in an alert', () => {
    const markup = renderToStaticMarkup(<Login onSignedIn={NO_OP} />);
    expect(markup).toContain('name="username"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toContain('role="alert"');
  });
});
