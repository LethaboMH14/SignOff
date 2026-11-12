import '@fontsource/nunito/800.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import './styles.css';
import './desk.css';
import './views.css';

import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';

import { DeskView } from './DeskView.js';
import { InvoiceView } from './InvoiceView.js';
import { LimitsForm } from './DeskView.js';
import { ReceiptView } from './ReceiptView.js';
import { deskFixture, holdFixture, receiptFixture } from './demo-fixtures.js';

/**
 * The demo page: the four operator views against FIXTURE data, with no server and no ledger. The route is the hash:
 * #desk, #hold, #limits or #receipt. Every screen is labelled as a fixture.
 */
const VIEWS = ['desk', 'hold', 'limits', 'receipt'] as const;
type DemoView = (typeof VIEWS)[number];

function labelOf(view: DemoView): string {
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

function viewOf(hash: string): DemoView {
  const name = hash.replace(/^#/, '');
  return (VIEWS as readonly string[]).includes(name) ? (name as DemoView) : 'desk';
}

const NOOP = (): void => undefined;

function Demo() {
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

const container = document.getElementById('root');
if (container === null) {
  throw new Error('the page has no root element');
}
createRoot(container).render(<Demo />);
