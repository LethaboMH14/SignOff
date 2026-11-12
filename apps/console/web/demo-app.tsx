import { useEffect, useState } from 'react';

import { DeskView, LimitsForm } from './DeskView.js';
import { InvoiceView } from './InvoiceView.js';
import { ReceiptView } from './ReceiptView.js';
import { deskFixture, holdFixture, receiptFixture } from './demo-fixtures.js';

/**
 * The demo page's app: the four operator views against FIXTURE data, with no server and no ledger. The route is the hash:
 * #desk, #hold, #limits or #receipt. Every screen is labelled as a fixture.
 */
export const VIEWS = ['desk', 'hold', 'limits', 'receipt'] as const;
export type DemoView = (typeof VIEWS)[number];

export function labelOf(view: DemoView): string {
  switch (view) {
    case 'desk':
      return '1 Payment desk';
    case 'hold':
      return '2 Changed-payout hold';
    case 'limits':
      return '3 Operator limits';
    case 'receipt':
      return '4 Ledger receipt';
  }
}

/** The view a hash names. Anything else shows the payment desk. */
export function viewOf(hash: string): DemoView {
  const name = hash.replace(/^#/, '');
  return (VIEWS as readonly string[]).includes(name) ? (name as DemoView) : 'desk';
}

const NOOP = (): void => undefined;

export function Demo() {
  const [view, setView] = useState<DemoView>(() => viewOf(window.location.hash));
  useEffect(() => {
    const onHash = (): void => {
      setView(viewOf(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const desk = deskFixture();
  return (
    <main className="demo">
      <p className="fixture-banner" role="note">
        FIXTURE DEMO. Invented data for review. Nothing here is live, and no money moved.
      </p>
      <nav className="demo-views" aria-label="Demo views">
        {VIEWS.map((name) => (
          <a key={name} href={`#${name}`} aria-current={view === name ? 'page' : undefined}>
            {labelOf(name)}
          </a>
        ))}
      </nav>
      {view === 'desk' ? (
        <DeskView
          data={desk}
          error={null}
          busy={false}
          pending={null}
          onTogglePause={NOOP}
          onRequestLimits={NOOP}
          onApprove={NOOP}
          onConfirm={() => Promise.resolve()}
          onCancelConfirm={NOOP}
          onOpen={NOOP}
          onReceipt={NOOP}
        />
      ) : null}
      {view === 'hold' ? <InvoiceView detail={holdFixture()} error={null} onBack={NOOP} /> : null}
      {view === 'limits' ? (
        <section className="panel" aria-labelledby="limits-demo-title">
          <h2 id="limits-demo-title">Operator limits</h2>
          <p>
            Each limit says what its change does before you ask for it. A lower limit applies at
            once. A raise needs a second operator.
          </p>
          <LimitsForm current={desk.overview.limits} busy={false} onSubmit={NOOP} />
        </section>
      ) : null}
      {view === 'receipt' ? (
        <ReceiptView receipt={receiptFixture()} error={null} onBack={NOOP} />
      ) : null}
    </main>
  );
}
