import { dom } from './helpers/jsdom-setup.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { TestInvoiceChoice, TestInvoiceResult } from '../web/api.js';
import { TestInvoicePanel } from '../web/DeskView.js';

/*
 * The test invoice panel in a DOM: a typed amount, two choices and a submitted form, as an operator uses it.
 */

let root: Root;

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

function mount(
  onSend: (choice: TestInvoiceChoice) => Promise<TestInvoiceResult>,
  mailTo: string | null,
): HTMLElement {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.replaceChildren(container);
  root = createRoot(container);
  act(() => {
    root.render(<TestInvoicePanel onSend={onSend} mailTo={mailTo} />);
  });
  return container;
}

function typeInto(input: HTMLInputElement, text: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set?.call(
    input,
    text,
  );
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function choose(select: HTMLSelectElement, value: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set?.call(
    select,
    value,
  );
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form');
  if (form === null) {
    throw new Error('the form is missing');
  }
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function parts(container: HTMLElement) {
  const input = container.querySelector('input');
  const selects = container.querySelectorAll('select');
  const [delivery, kind] = [selects[0], selects[1]];
  if (input === null || delivery === undefined || kind === undefined) {
    throw new Error('the panel is missing a control');
  }
  return { input, delivery, kind };
}

describe('the test invoice panel in a DOM', () => {
  it('prepares a fraud invoice to email and offers its download', async () => {
    const sent: TestInvoiceChoice[] = [];
    const container = mount((choice) => {
      sent.push(choice);
      return Promise.resolve({
        invoiceNumber: 'INV-DEMO-20261113100000-B',
        usdMinor: 150,
        download: '/api/demo/outbox/INV-DEMO-20261113100000-B.pdf',
      });
    }, 'signoff@example.com');
    const { input, delivery, kind } = parts(container);
    act(() => {
      typeInto(input, '25.00');
      choose(delivery, 'email');
      choose(kind, 'bank-change');
    });
    await submit(container);
    expect(sent).toEqual([{ zarMinor: 2500, delivery: 'email', variant: 'bank-change' }]);
    expect(container.textContent).toContain('send it to signoff@example.com');
    expect(container.querySelector('a[download]')?.getAttribute('href')).toBe(
      '/api/demo/outbox/INV-DEMO-20261113100000-B.pdf',
    );
  });

  it('sends a clean invoice straight to the agent, and switches back from email', async () => {
    const sent: TestInvoiceChoice[] = [];
    const container = mount((choice) => {
      sent.push(choice);
      return Promise.resolve({ invoiceNumber: 'INV-DEMO-1', usdMinor: 120, download: null });
    }, 'signoff@example.com');
    const { delivery, kind } = parts(container);
    act(() => {
      choose(delivery, 'inbox');
      choose(kind, 'clean');
    });
    await submit(container);
    expect(sent).toEqual([{ zarMinor: 2000, delivery: 'inbox', variant: 'clean' }]);
    expect(container.textContent).toContain('USD 1.20');
    expect(container.querySelector('a[download]')).toBeNull();
  });

  it('refuses an amount out of range without sending', async () => {
    const sent: TestInvoiceChoice[] = [];
    const container = mount((choice) => {
      sent.push(choice);
      return Promise.resolve({ invoiceNumber: 'x', usdMinor: 1, download: null });
    }, null);
    act(() => {
      typeInto(parts(container).input, '0.50');
    });
    await submit(container);
    expect(sent).toEqual([]);
    expect(container.textContent).toContain('Enter an amount from R1.00 to R10,000.00.');
  });

  it('shows the console’s refusal when the write fails', async () => {
    const container = mount(() => Promise.reject(new Error('only an operator can do this')), null);
    await submit(container);
    expect(container.textContent).toContain('only an operator can do this');
  });
});
