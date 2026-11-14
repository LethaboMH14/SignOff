import { dom } from './helpers/jsdom-setup.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeskData, SessionInfo } from '../web/api.js';
import { Desk } from '../web/Desk.js';
import { PAGES, Studio, toneOf } from '../web/Studio.js';
import { DISPLAY_STATES } from '../src/model/desk.js';

/*
 * The studio console in a DOM, against a stubbed console API: every page, the queue, the evidence and receipt lists, and
 * the operator's changes (pause with a password check, limits, an approval and a test invoice) through the shared desk.
 */

const SESSION: SessionInfo = {
  username: 'alice.operator',
  role: 'operator',
  csrfToken: 'csrf-token',
  stepUp: false,
};

function counts(overrides: Partial<Record<(typeof DISPLAY_STATES)[number], number>>) {
  return Object.fromEntries(
    DISPLAY_STATES.map((state) => [state, new Map(Object.entries(overrides)).get(state) ?? 0]),
  ) as DeskData['counts'];
}

function deskOf(overrides: Partial<DeskData> = {}): DeskData {
  return {
    asOf: '2026-11-13T21:00:00.000Z',
    mode: 'live',
    damagedLines: 0,
    overview: {
      paused: false,
      policyVersion: '2026-11-10.1',
      limits: { perPaymentMinor: 500, supplierDailyMinor: 2000, dailyTotalMinor: 2000 },
      usageToday: { day: '2026-11-13', totalMinor: 118 },
      pendingLimitChange: {
        requestId: 'c'.repeat(36),
        requestedBy: 'bob',
        expiresAt: '2026-11-14T08:00:00.000Z',
        perPaymentMinor: 900,
        supplierDailyMinor: 2000,
        dailyTotalMinor: 2000,
        approvalAllowed: true,
        why: 'A second operator approves this raise.',
      },
    },
    counts: counts({ Paid: 1, Held: 1, Quarantined: 1 }),
    rows: [
      {
        rowId: 'a'.repeat(36),
        invoiceRef: 'aaaaaaaa',
        attemptId: 'a'.repeat(36),
        supplierId: 'SUP-ABCD1234',
        amountMinor: 118,
        currency: 'USD',
        displayState: 'Paid',
        reasonCode: 'OK',
        reason: 'Paid: validated and reconciled.',
        modelCalls: 1,
        updatedAt: '2026-11-13T21:54:00.000Z',
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
        updatedAt: '2026-11-13T21:50:00.000Z',
      },
      {
        rowId: 'd'.repeat(64),
        invoiceRef: 'dddddddd',
        attemptId: null,
        supplierId: null,
        amountMinor: 2000,
        currency: 'USD',
        displayState: 'Quarantined',
        reasonCode: 'PAYEE_CHANGE_CLAIM',
        reason: 'The invoice says the bank details have changed.',
        modelCalls: 0,
        updatedAt: '2026-11-13T21:55:00.000Z',
      },
    ],
    testInvoices: true,
    mailTo: null,
    ...overrides,
  };
}

const INVOICE = {
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
  nextAction: 'Link the purchase order, then propose the invoice again.',
  enrolledPayee: null,
  payoutChange: null,
  wardenDecision: null,
  history: [],
};

const RECEIPT = {
  state: 'receipt',
  invoiceRef: 'aaaaaaaa',
  amount: '1.18',
  currency: 'USD',
  asset: 'RLUSD',
  deliveredValue: '1.18',
  ledgerIndex: 22302966,
  explorerUrl: `https://testnet.xrpl.org/transactions/${'A'.repeat(64)}`,
  rand: { label: 'SIMULATED', amount: 'R20.00', rate: '16.96' },
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

let calls: Call[] = [];
let desk: DeskData = deskOf();
let receipt: unknown = RECEIPT;
let pauseRefusals = 0;
let root: Root | null = null;

function reply(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function api(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    'http://127.0.0.1',
  );
  const method = init?.method ?? 'GET';
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: url.pathname, body });
  if (url.pathname === '/api/desk') {
    return reply(desk);
  }
  if (url.pathname.startsWith('/api/invoices/')) {
    return reply(INVOICE);
  }
  if (url.pathname.startsWith('/api/receipts/')) {
    return reply(receipt);
  }
  if (url.pathname === '/api/transitions') {
    return reply({ mode: 'live', damaged: 0, events: [] });
  }
  if (url.pathname === '/api/control/pause') {
    if (pauseRefusals > 0) {
      pauseRefusals -= 1;
      return reply({ error: 'confirm your password', code: 'STEP_UP_REQUIRED' }, 403);
    }
    return reply({ paused: true });
  }
  if (url.pathname === '/api/session/step-up') {
    return reply({ stepUpUntil: '2026-11-13T22:05:00.000Z' });
  }
  if (url.pathname === '/api/limits') {
    return reply({ applied: true });
  }
  if (url.pathname.endsWith('/approve')) {
    return reply({ approved: true, policyVersion: '2026-11-10.1' });
  }
  if (url.pathname === '/api/demo/invoice') {
    return reply({ invoiceNumber: 'INV-DEMO-1', usdMinor: 118, download: null });
  }
  return reply({ error: 'not found' }, 404);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }
  });
}

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.replaceChildren(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
  await settle();
  return container;
}

async function click(element: Element | null | undefined): Promise<void> {
  if (element === null || element === undefined) {
    throw new Error('the element is missing');
  }
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

function button(container: HTMLElement, text: RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((candidate) =>
    text.test(candidate.textContent),
  );
}

async function goTo(container: HTMLElement, label: string): Promise<void> {
  const nav = container.querySelector('.so-nav');
  await click(
    [...(nav?.querySelectorAll('button') ?? [])].find((candidate) =>
      candidate.textContent.includes(label),
    ),
  );
}

function typeInto(input: HTMLInputElement, text: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set?.call(
    input,
    text,
  );
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

async function submit(form: HTMLFormElement | null): Promise<void> {
  if (form === null) {
    throw new Error('the form is missing');
  }
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  calls = [];
  desk = deskOf();
  receipt = RECEIPT;
  pauseRefusals = 0;
  vi.stubGlobal('fetch', vi.fn(api));
  dom.window.scrollTo = () => undefined;
  dom.window.location.hash = '';
});

afterEach(() => {
  if (root !== null) {
    const mounted = root;
    act(() => {
      mounted.unmount();
    });
    root = null;
  }
  vi.unstubAllGlobals();
});

describe('the studio tone of each state', () => {
  it('gives every display state a tone, with words beside the colour', () => {
    const tones = DISPLAY_STATES.map((state) => toneOf(state));
    expect(tones).toContain('good');
    expect(tones).toContain('bad');
    expect(tones).toContain('warn');
    expect(tones).toContain('info');
    expect(tones).toContain('neutral');
    expect(PAGES.map(([id]) => id)).toContain('map');
  });
});

describe('the studio console', () => {
  it('shows a loading line before the desk answers, then the overview from the console API', async () => {
    const markup = renderToStaticMarkup(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    expect(markup).toContain('Loading the desk');

    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    const text = container.textContent;
    expect(text).toContain('One clear decision at a time.');
    expect(text).toContain('Priority exception');
    expect(text).toContain('Payment stopped');
    expect(text).toContain('LIVE · XRPL TESTNET');
    expect(text).toContain('Running · rules 2026-11-10.1');
    expect(calls.some((call) => call.path === '/api/desk')).toBe(true);
  });

  it('opens a held invoice on the evidence desk and a paid one as a receipt', async () => {
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    await click(button(container, /Review evidence/));
    expect(container.textContent).toContain('The truth, beside the document.');
    expect(calls.some((call) => call.path.startsWith('/api/invoices/'))).toBe(true);

    await click(button(container, /^bbbbbbbb/));
    expect(container.textContent).toContain('Link the purchase order');
    await click(button(container, /Back to the queue/));
    expect(container.textContent).toContain('Choose an invoice');

    await goTo(container, 'Overview');
    const paidRow = [...container.querySelectorAll('.so-queue-line.clickable')].find((row) =>
      row.textContent.includes('aaaaaaaa'),
    );
    await click(paidRow);
    expect(container.textContent).toContain('Certificate of Testnet');
    expect(container.textContent).toContain('R20.00 (SIMULATED)');
  });

  it('lists paid invoices on the receipts page and says when the ledger did not confirm one', async () => {
    receipt = {
      state: 'not-confirmed',
      message: 'Not confirmed on the ledger: no validated result.',
    };
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    await goTo(container, 'Receipts');
    expect(container.textContent).toContain('Choose a paid invoice');
    await click(button(container, /^aaaaaaaa/));
    expect(container.textContent).toContain('Not confirmed on the ledger');
  });

  it('visits every page from the sidebar, opens the menu and signs out', async () => {
    const signOut = vi.fn();
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={signOut} />,
    );
    await goTo(container, 'Payment desk');
    expect(container.textContent).toContain('A queue built for decisions.');
    await goTo(container, 'Warden engine');
    expect(container.textContent).toContain('Where automation ends.');
    expect(container.textContent).toContain('Rules in effect');
    await goTo(container, 'Agent map');
    expect(container.textContent).toContain('See the work. Not a black box.');
    await goTo(container, 'African trade');
    expect(container.textContent).toContain('Lusaka to Cape Town.');
    await goTo(container, 'Evidence desk');
    expect(container.textContent).toContain('Invoices needing a person');

    await click(container.querySelector('.so-mobile-menu'));
    expect(container.querySelector('.so-sidebar.open')).not.toBeNull();

    dom.window.location.hash = '#trade';
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('One journey. Two countries.');

    await click(button(container, /^Sign out$/));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('pauses after the password check, asks for limits and approves a raise from the Warden page', async () => {
    pauseRefusals = 1;
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    await goTo(container, 'Warden engine');

    await click(button(container, /Pause new payments/));
    const stepUp = container.querySelector<HTMLFormElement>('form.stepup');
    const password = stepUp?.querySelector<HTMLInputElement>('input[type=password]');
    if (password === null || password === undefined) {
      throw new Error('the password check did not open');
    }
    typeInto(password, 'correct horse battery');
    await submit(stepUp ?? null);
    expect(calls.filter((call) => call.path === '/api/control/pause')).toHaveLength(2);
    expect(calls.some((call) => call.path === '/api/session/step-up')).toBe(true);

    const limits = container.querySelector<HTMLFormElement>('form.limits-form');
    const first = limits?.querySelector<HTMLInputElement>('input');
    if (first === null || first === undefined) {
      throw new Error('the limits form is missing');
    }
    typeInto(first, '4.00');
    await submit(limits ?? null);
    expect(calls.some((call) => call.path === '/api/limits')).toBe(true);

    await click(button(container, /Approve the raised limit/));
    expect(calls.some((call) => call.path.endsWith('/approve'))).toBe(true);
  });

  it('cancels a waiting password check without sending the change again', async () => {
    pauseRefusals = 1;
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    await goTo(container, 'Warden engine');
    await click(button(container, /Pause new payments/));
    await click(button(container, /^Cancel$/));
    expect(container.querySelector('form.stepup')).toBeNull();
    expect(calls.filter((call) => call.path === '/api/control/pause')).toHaveLength(1);
  });

  it('sends a fictional test invoice from the payment desk', async () => {
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    await goTo(container, 'Payment desk');
    const panel = container.querySelector('section.test-invoice');
    await submit(panel?.querySelector('form') ?? null);
    expect(calls.some((call) => call.path === '/api/demo/invoice')).toBe(true);
  });

  it('says when nothing needs a person and the Warden is paused', async () => {
    desk = deskOf({
      rows: [],
      counts: counts({}),
      mode: 'simulated',
      overview: { ...deskOf().overview, paused: true, pendingLimitChange: null },
    });
    const container = await mount(
      <Studio session={SESSION} onSession={() => undefined} onSignOut={() => undefined} />,
    );
    const text = container.textContent;
    expect(text).toContain('Nothing needs a person right now.');
    expect(text).toContain('Warden paused');
    expect(text).toContain('SIMULATED REPLAY');
    expect(text).toContain('No invoices yet.');
    await goTo(container, 'Evidence desk');
    expect(container.textContent).toContain('Nothing is held.');
    await goTo(container, 'Receipts');
    expect(container.textContent).toContain('Nothing is paid yet.');
  });

  it('shows the desk on its own with its own state', async () => {
    const container = await mount(<Desk session={SESSION} onSession={() => undefined} />);
    expect(container.textContent).toContain('Send a test invoice');
  });
});
