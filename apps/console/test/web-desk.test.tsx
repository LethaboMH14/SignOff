import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type DeskData } from '../web/api.js';
import { DeskView, HEADLINE_STATES, moneyOf, sastOf } from '../web/DeskView.js';
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

const NO_OP = (): void => undefined;
const NO_OP_ASYNC = (): Promise<void> => Promise.resolve();

function deskOf(
  data: DeskData | null,
  waitingFor: boolean | null = null,
  error: string | null = null,
): string {
  return renderToStaticMarkup(
    <DeskView
      data={data}
      error={error}
      busy={false}
      waitingFor={waitingFor}
      onTogglePause={NO_OP}
      onConfirm={NO_OP_ASYNC}
      onCancelConfirm={NO_OP}
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

  it('asks for the password before a pause, and says what it is for', () => {
    const markup = deskOf(dataOf(), true);
    expect(markup).toContain('aria-label="Confirm your password"');
    expect(markup).toContain('Confirm your password to make this change.');
    expect(deskOf(dataOf())).not.toContain('Confirm your password to make this change.');
  });

  it('says a raised limit is waiting for a second operator', () => {
    const markup = deskOf(
      dataOf({
        overview: {
          ...dataOf().overview,
          pendingLimitChange: {
            requestId: 'c'.repeat(8),
            requestedBy: 'alice',
            expiresAt: '2026-11-12T08:00:00.000Z',
          },
        },
      }),
    );
    expect(markup).toContain('waiting for a second operator');
  });
});

describe('formatting', () => {
  it('shows minor units with two decimals, and a time in South African time', () => {
    expect(moneyOf(5, null)).toBe('0.05');
    expect(moneyOf(125000, 'USD')).toBe('1,250.00 USD');
    expect(sastOf('not a time')).toBe('time not recorded');
    expect(sastOf('2026-11-11T09:00:00.000Z')).toContain('11:00');
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
