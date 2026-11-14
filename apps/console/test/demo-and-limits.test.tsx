import { dom } from './helpers/jsdom-setup.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { DISPLAY_STATES } from '../src/model/desk.js';
import { Demo, labelOf, viewOf, VIEWS } from '../web/demo-app.js';
import { deskFixture, holdFixture, receiptFixture } from '../web/demo-fixtures.js';
import { LimitsForm } from '../web/DeskView.js';

/*
 * The demo page and the limits form run in a DOM (jsdom), so their handlers are exercised as a person would use them:
 * a hash change, a click, a typed amount and a submitted form. The fixtures are plain data and need no DOM.
 */

describe('the demo fixtures', () => {
  it('count every display state, and the desk holds one held invoice and one paid one', () => {
    const desk = deskFixture();
    expect(desk.mode).toBe('simulated');
    expect(Object.keys(desk.counts).sort()).toEqual([...DISPLAY_STATES].sort());
    expect(desk.counts.Held).toBe(1);
    expect(desk.counts.Paid).toBe(1);
    expect(desk.rows.reduce((sum, row) => sum + desk.counts[row.displayState], 0)).toBe(
      desk.rows.length,
    );
  });

  it('gives a held payout change with the rules passed, and a receipt labelled SIMULATED', () => {
    expect(holdFixture().payoutChange?.status).toBe('requested');
    expect(holdFixture().wardenDecision?.decision).toBe('ALLOW');
    const receipt = receiptFixture();
    expect(receipt.state).toBe('receipt');
    if (receipt.state === 'receipt') {
      expect(receipt.rand?.label).toBe('SIMULATED');
    }
  });
});

describe('the demo routes', () => {
  it('reads the view from the hash, and shows the payment desk for anything else', () => {
    expect(viewOf('#hold')).toBe('hold');
    expect(viewOf('limits')).toBe('limits');
    expect(viewOf('#unknown')).toBe('desk');
    expect(viewOf('')).toBe('desk');
  });

  it('labels each of the four views', () => {
    expect(VIEWS.map((view) => labelOf(view))).toEqual([
      '1 Payment desk',
      '2 Changed-payout hold',
      '3 Operator limits',
      '4 Ledger receipt',
    ]);
  });
});

/** Types text into an input the way a person does: the native value setter, then an input event. */
function typeInto(input: HTMLInputElement, text: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set?.call(
    input,
    text,
  );
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

describe('the demo page in a DOM', () => {
  let root: Root;
  let container: HTMLElement;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
  });

  function mount(hash: string): HTMLElement {
    dom.window.location.hash = hash;
    container = dom.window.document.createElement('div');
    dom.window.document.body.replaceChildren(container);
    root = createRoot(container);
    act(() => {
      root.render(<Demo />);
    });
    return container;
  }

  function buttonNamed(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === text,
    );
    if (found === undefined) {
      throw new Error(`no button named ${text}`);
    }
    return found;
  }

  it('shows the fixture banner, the four view links, and the desk by default', () => {
    mount('');
    expect(container.textContent).toContain('FIXTURE DEMO');
    expect(container.querySelectorAll('nav a')).toHaveLength(4);
    expect(container.textContent).toContain('Payment desk');
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('1 Payment desk');
  });

  it('changes the view when the hash changes', () => {
    mount('#desk');
    dom.window.location.hash = '#receipt';
    act(() => {
      dom.window.dispatchEvent(new dom.window.Event('hashchange'));
    });
    expect(container.textContent).toContain('Receipt for invoice INV-24017');
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('4 Ledger receipt');
  });

  it('shows the changed-payout hold with the evidence path', () => {
    mount('#hold');
    expect(container.textContent).toContain('Payment evidence path');
    expect(container.textContent).toContain('Invoice INV-24018');
  });

  it('sends the desk actions to the demo handlers when they are pressed', () => {
    mount('#desk');
    for (const name of ['Pause new payments', 'Open evidence', 'Approve the raised limit']) {
      act(() => {
        buttonNamed(name).click();
      });
    }
    act(() => {
      buttonNamed('Ask for these limits').click();
    });
    expect(container.textContent).toContain('Operator limits');
  });

  it('the limits view shows each limit with its effect, and a typed amount updates it', () => {
    mount('#limits');
    const input = container.querySelector<HTMLInputElement>('input[name="perPayment"]');
    if (input === null) {
      throw new Error('the per-payment limit field is missing');
    }
    act(() => {
      typeInto(input, '4000.00');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Lower: applies at once.');
  });
});

describe('the limits form', () => {
  const current = {
    perPaymentMinor: 500000,
    supplierDailyMinor: 1000000,
    dailyTotalMinor: 2000000,
  };

  it('submits the typed limits in minor units', () => {
    const container = dom.window.document.createElement('div');
    dom.window.document.body.replaceChildren(container);
    const root = createRoot(container);
    const sent: unknown[] = [];
    act(() => {
      root.render(
        <LimitsForm
          current={current}
          busy={false}
          onSubmit={(values) => {
            sent.push(values);
          }}
        />,
      );
    });
    const form = container.querySelector('form');
    if (form === null) {
      throw new Error('the limits form is missing');
    }
    act(() => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(sent).toEqual([
      { perPaymentMinor: 500000, supplierDailyMinor: 1000000, dailyTotalMinor: 2000000 },
    ]);
    act(() => {
      root.unmount();
    });
  });

  it('refuses a limit that is not an amount, and sends nothing', () => {
    const container = dom.window.document.createElement('div');
    dom.window.document.body.replaceChildren(container);
    const root = createRoot(container);
    const sent: unknown[] = [];
    act(() => {
      root.render(
        <LimitsForm
          current={current}
          busy={false}
          onSubmit={(values) => {
            sent.push(values);
          }}
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>('input[name="total"]');
    const form = container.querySelector('form');
    if (input === null || form === null) {
      throw new Error('the limits form is missing');
    }
    act(() => {
      typeInto(input, 'lots');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Enter an amount');
    act(() => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(sent).toEqual([]);
    expect(container.textContent).toContain('Enter each limit as an amount');
    act(() => {
      root.unmount();
    });
  });
});
