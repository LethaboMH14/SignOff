import { useEffect, useState, type ReactNode } from 'react';

import type { DeskData, SessionInfo } from './api.js';
import type { DeskRow, DisplayState } from '../src/model/desk.js';
import { DeskPanel } from './Desk.js';
import { featuredOf, moneyOf, shortSastOf } from './DeskView.js';
import { InvoiceView } from './InvoiceView.js';
import { MapView } from './MapView.js';
import type { ReceiptView as ReceiptData } from '../src/server/receipt.js';
import { type DeskState, useDesk } from './useDesk.js';

export type PageId = 'overview' | 'payments' | 'evidence' | 'warden' | 'map' | 'receipts' | 'trade';

export const PAGES: readonly (readonly [PageId, string, string])[] = [
  ['overview', 'Overview', '⌂'],
  ['payments', 'Payment desk', '▤'],
  ['evidence', 'Evidence desk', '▣'],
  ['warden', 'Warden engine', '◇'],
  ['map', 'Agent map', '⌁'],
  ['receipts', 'Receipts & ledger', '≋'],
  ['trade', 'African trade', '↗'],
];

const ATTENTION: readonly DisplayState[] = ['Held', 'Needs a person', 'Quarantined'];

/** The pill tone for a display state. Words always go with the colour. */
export function toneOf(state: DisplayState): 'good' | 'bad' | 'warn' | 'info' | 'neutral' {
  switch (state) {
    case 'Paid':
      return 'good';
    case 'Held':
    case 'Quarantined':
    case 'Refused':
    case 'Failed':
    case 'Not paid':
      return 'bad';
    case 'Needs a person':
      return 'warn';
    case 'In progress':
    case 'Received':
      return 'info';
    default:
      return 'neutral';
  }
}

function Pill({ tone, children }: { readonly tone: string; readonly children: ReactNode }) {
  return <span className={`so-pill ${tone}`}>{children}</span>;
}

function count(data: DeskData, state: DisplayState): number {
  return Object.entries(data.counts).find(([key]) => key === state)?.[1] ?? 0;
}

function amountOf(row: DeskRow): string {
  return row.amountMinor === null ? 'Amount not recorded' : moneyOf(row.amountMinor, row.currency);
}

function PageHeader(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="so-page-header">
      <div>
        <div className="so-eyebrow teal">{props.eyebrow}</div>
        <h1>{props.title}</h1>
        <p className="so-lede">{props.lede}</p>
      </div>
      <div className="so-header-actions">{props.children}</div>
    </div>
  );
}

function Loading({ desk }: { readonly desk: DeskState }) {
  return (
    <p role="status" className="so-card so-card-pad">
      {desk.error ?? 'Loading the desk…'}
    </p>
  );
}

function QueueTable({
  rows,
  onOpen,
}: {
  readonly rows: readonly DeskRow[];
  readonly onOpen: (row: DeskRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="so-card-pad so-muted">
        No invoices yet. Send a test invoice from the payment desk.
      </p>
    );
  }
  return (
    <div className="so-queue">
      <div className="so-queue-line head" aria-hidden="true">
        <div>Invoice</div>
        <div>Amount</div>
        <div>Status</div>
        <div>Updated</div>
        <div />
      </div>
      {rows.map((row) => (
        <button
          type="button"
          key={row.rowId}
          className="so-queue-line clickable"
          onClick={() => {
            onOpen(row);
          }}
        >
          <div>
            <b className="so-mono">{row.invoiceRef}</b>
            <small>{row.reason}</small>
          </div>
          <b className="so-money">{amountOf(row)}</b>
          <div>
            <Pill tone={toneOf(row.displayState)}>{row.displayState}</Pill>
          </div>
          <small>{shortSastOf(row.updatedAt)}</small>
          <span className="so-queue-right" aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </div>
  );
}

function ControlCard({
  data,
  go,
}: {
  readonly data: DeskData;
  readonly go: (page: PageId) => void;
}) {
  const { overview } = data;
  return (
    <div className="so-control-card">
      <div className="so-eyebrow">What protects the money</div>
      <h2>
        Two independent decisions.
        <br />
        One safe boundary.
      </h2>
      <p>
        The agent can propose a payment. The Warden checks its own rules and gives the second
        signature only when every rule passes. The XRP Ledger refuses a payment with one signature.
      </p>
      <div className="so-chain" aria-label="Agent, then Warden, then XRP Ledger">
        <div className="so-chain-node">
          <strong aria-hidden="true">✧</strong>Agent
        </div>
        <span className="so-chain-arrow" aria-hidden="true">
          →
        </span>
        <div className="so-chain-node warden">
          <strong aria-hidden="true">◇</strong>Warden
        </div>
        <span className="so-chain-arrow" aria-hidden="true">
          →
        </span>
        <div className="so-chain-node">
          <strong aria-hidden="true">≋</strong>XRPL
        </div>
      </div>
      <div className="so-control-rule">
        <span>Warden</span>
        <b>{overview.paused ? 'Paused: no new payments' : 'Running'}</b>
      </div>
      <div className="so-control-rule">
        <span>Per payment limit</span>
        <b>{moneyOf(overview.limits.perPaymentMinor, 'USD')}</b>
      </div>
      <div className="so-control-rule">
        <span>Single-key payment</span>
        <b>Refused by the ledger</b>
      </div>
      <div className="so-control-rule">
        <span>Rand payout to supplier</span>
        <b>SIMULATED</b>
      </div>
      <button
        type="button"
        className="so-btn so-btn-small"
        onClick={() => {
          go('warden');
        }}
      >
        Open the Warden engine ↗
      </button>
    </div>
  );
}

function Overview({ desk, go }: { readonly desk: DeskState; readonly go: (page: PageId) => void }) {
  const { data } = desk;
  if (data === null) {
    return <Loading desk={desk} />;
  }
  const featured = featuredOf(data.rows);
  const featuredNeeds = featured !== null && ATTENTION.includes(featured.displayState);
  const attention =
    count(data, 'Held') + count(data, 'Needs a person') + count(data, 'Quarantined');
  const recent = [...data.rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const open = (row: DeskRow): void => {
    if (row.displayState === 'Paid' && row.attemptId !== null) {
      desk.openReceipt(row.attemptId);
      go('receipts');
    } else {
      desk.openInvoice(row.rowId);
      go('evidence');
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Finance operations / overview"
        title="One clear decision at a time."
        lede="Your agent handles the routine. SignOff brings forward the exceptions that need a responsible person."
      >
        <button
          type="button"
          className="so-btn"
          onClick={() => {
            go('payments');
          }}
        >
          View all payments →
        </button>
      </PageHeader>
      <div className="so-grid-main">
        <div>
          <div className="so-hero">
            <div className="so-hero-head">
              <div>
                <div className="so-overline">
                  {data.mode === 'live' ? 'Live on XRPL Testnet' : 'Simulated replay'}
                </div>
                <div className="so-hero-title">
                  Your payments are
                  <br />
                  under independent control.
                </div>
                <p className="so-hero-desc">
                  {attention === 0
                    ? 'Nothing needs a person right now. Every payment keeps its own verifiable status.'
                    : `${String(attention)} invoice${attention === 1 ? ' needs' : 's need'} a person. Everything else keeps its own verifiable status.`}
                </p>
              </div>
              <Pill tone={data.overview.paused ? 'warn' : 'good'}>
                {data.overview.paused ? 'Warden paused' : 'Warden checks active'}
              </Pill>
            </div>
            {featured !== null && featuredNeeds ? (
              <div className="so-attention">
                <div className="so-alert-symbol" aria-hidden="true">
                  !
                </div>
                <div>
                  <div className="so-smallcaps red">Priority exception</div>
                  <h2>
                    {featured.displayState === 'Quarantined'
                      ? 'Stopped before any AI read it'
                      : 'Payment stopped'}
                  </h2>
                  <div className="so-micro">Invoice {featured.invoiceRef}</div>
                  <div
                    className={`so-amount-large so-money ${featured.amountMinor === null ? 'small' : ''}`}
                  >
                    {amountOf(featured)}
                  </div>
                </div>
                <div className="so-reason">
                  <b>Why</b>
                  <p>{featured.reason}</p>
                  <Pill tone="bad">{featured.displayState} · nothing paid</Pill>
                </div>
                <button
                  type="button"
                  className="so-btn so-btn-primary"
                  onClick={() => {
                    open(featured);
                  }}
                >
                  Review evidence →
                </button>
              </div>
            ) : null}
            <div className="so-thin-metrics">
              <div>
                <span className="so-smallcaps">Needs review</span>
                <b>{String(attention).padStart(2, '0')}</b>
              </div>
              <div>
                <span className="so-smallcaps">In progress</span>
                <b>
                  {String(count(data, 'In progress') + count(data, 'Received')).padStart(2, '0')}
                </b>
              </div>
              <div>
                <span className="so-smallcaps">Paid on Testnet</span>
                <b>{String(count(data, 'Paid')).padStart(2, '0')}</b>
              </div>
            </div>
          </div>
          <div className="so-section-title">
            <h2>Payment queue</h2>
            <button
              type="button"
              className="so-btn so-btn-small so-btn-plain"
              onClick={() => {
                go('payments');
              }}
            >
              Open payment desk ↗
            </button>
          </div>
          <div className="so-card">
            <QueueTable rows={data.rows.slice(0, 6)} onOpen={open} />
          </div>
        </div>
        <div>
          <ControlCard data={data} go={go} />
          <div className="so-section-title">
            <h2>Recent activity</h2>
            <button
              type="button"
              className="so-btn so-btn-small so-btn-plain"
              onClick={() => {
                go('map');
              }}
            >
              Agent map →
            </button>
          </div>
          <div className="so-card so-card-pad so-recent">
            {recent.map((row) => (
              <div className="so-recent-row" key={row.rowId}>
                <span className={`so-recent-mark ${toneOf(row.displayState)}`} aria-hidden="true">
                  {row.displayState === 'Paid'
                    ? '✓'
                    : toneOf(row.displayState) === 'bad'
                      ? '!'
                      : '◷'}
                </span>
                <div>
                  <b>
                    {row.displayState}: {row.invoiceRef}
                  </b>
                  <p>{row.reason}</p>
                </div>
                <time>{shortSastOf(row.updatedAt)}</time>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Payments({ desk }: { readonly desk: DeskState }) {
  return (
    <>
      <PageHeader
        eyebrow="Accounts payable / payment desk"
        title="A queue built for decisions."
        lede="See where each invoice stands, open its evidence, and send a fictional test invoice to watch the agents work."
      />
      <div className="so-embed">
        <DeskPanel desk={desk} />
      </div>
    </>
  );
}

function Evidence({ desk, go }: { readonly desk: DeskState; readonly go: (page: PageId) => void }) {
  const { data } = desk;
  if (data === null) {
    return <Loading desk={desk} />;
  }
  const needing = data.rows.filter(
    (row) => ATTENTION.includes(row.displayState) || row.displayState === 'Refused',
  );
  return (
    <>
      <PageHeader
        eyebrow="Invoice review / evidence desk"
        title="The truth, beside the document."
        lede="Each held invoice with the rule it broke, what the Warden decided, and the safe next step. There is no approve-anyway button."
      >
        <button
          type="button"
          className="so-btn"
          onClick={() => {
            go('payments');
          }}
        >
          Back to payment desk
        </button>
      </PageHeader>
      <div className="so-evidence-layout">
        <aside className="so-card">
          <div className="so-card-pad so-rule-below">
            <h2>Invoices needing a person</h2>
            <p className="so-card-sub">
              Held, quarantined or refused. Nothing in this list was paid.
            </p>
          </div>
          {needing.length === 0 ? (
            <p className="so-card-pad so-muted">Nothing is held.</p>
          ) : (
            needing.map((row) => (
              <button
                type="button"
                key={row.rowId}
                className={`so-run ${desk.openId === row.rowId ? 'selected' : ''}`}
                onClick={() => {
                  desk.openInvoice(row.rowId);
                }}
              >
                <b className="so-mono">{row.invoiceRef}</b>
                <small>{row.reason}</small>
                <Pill tone={toneOf(row.displayState)}>{row.displayState}</Pill>
              </button>
            ))
          )}
        </aside>
        <section className="so-card so-card-pad so-embed">
          {desk.openId === null ? (
            <div className="so-empty">
              <div className="so-rule-glyph" aria-hidden="true">
                ◇
              </div>
              <h2>Choose an invoice</h2>
              <p className="so-muted">
                Its evidence path, the Warden&rsquo;s decision and the audit timeline open here.
              </p>
            </div>
          ) : (
            <InvoiceView detail={desk.detail} error={desk.detailError} onBack={desk.closeInvoice} />
          )}
        </section>
      </div>
    </>
  );
}

const RULES: readonly (readonly [string, string])[] = [
  ['Payee matches the supplier’s verified payout record', 'Enforced'],
  ['Invoice matches a purchase order and goods received', 'Enforced'],
  ['The same supplier and invoice number is never paid twice', 'Enforced'],
  ['Per-payment, per-supplier and daily limits', 'Enforced'],
  ['Only a plain payment in the agreed currency', 'Enforced'],
  ['Supplier holds a valid on-ledger credential', 'Enforced'],
  ['Large payments need the owner’s phone signature', '3 of 3'],
  ['Operator pause stops new payments', 'Independent'],
  ['Missing evidence or a failed check', 'Hold'],
];

function Warden({ desk }: { readonly desk: DeskState }) {
  const { data } = desk;
  if (data === null) {
    return <Loading desk={desk} />;
  }
  const { overview } = data;
  return (
    <>
      <PageHeader
        eyebrow="Independent authorization / policy"
        title="Where automation ends."
        lede="The Warden is a separate service with its own key. It checks every proposal against fixed rules the agent cannot read, edit or argue with."
      />
      <div className="so-grid-2">
        <div className="so-rule-spotlight">
          <span className="so-rule-glyph" aria-hidden="true">
            ◇
          </span>
          <div>
            <div className="so-eyebrow">SignOff / Warden</div>
            <h2>Authority outside the agent.</h2>
            <p>
              Only the Warden gives the second signature. A failed rule means the payment cannot
              proceed, even if the AI believes the invoice is valid.
            </p>
          </div>
        </div>
        <div className="so-card so-card-pad">
          <div className="so-smallcaps">Live state</div>
          <div className="so-pair">
            <span>Status</span>
            <Pill tone={overview.paused ? 'warn' : 'good'}>
              {overview.paused ? 'Paused' : 'Running'}
            </Pill>
          </div>
          <div className="so-pair">
            <span>Rules version</span>
            <b className="so-mono">{overview.policyVersion}</b>
          </div>
          <div className="so-pair">
            <span>Signing boundary</span>
            <b>Agent + Warden (2 of 2)</b>
          </div>
          <div className="so-pair">
            <span>Network</span>
            <b>XRPL Testnet</b>
          </div>
        </div>
      </div>
      <div className="so-logic-grid">
        <div className="so-card so-card-pad so-embed">
          <div className="so-card-head">
            <div>
              <h2>Limits and pause</h2>
              <small>
                Lower a limit and it applies at once. Raise one and a second operator must approve
                it.
              </small>
            </div>
          </div>
          <DeskPanel desk={desk} initialTab="warden" deskOnly />
        </div>
        <div className="so-card so-card-pad">
          <div className="so-card-head">
            <div>
              <h2>Rules in effect</h2>
              <small>Checked by the Warden before it signs.</small>
            </div>
          </div>
          {RULES.map(([rule, how]) => (
            <div className="so-policy-row" key={rule}>
              <span className="so-check" aria-hidden="true">
                ✓
              </span>
              <b>{rule}</b>
              <span className="so-policy-right">{how}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function AgentMapPage() {
  return (
    <>
      <PageHeader
        eyebrow="Agent observability / live map"
        title="See the work. Not a black box."
        lede="Each token is one invoice, moving to the agent that just acted on it. Amber is held for a person. Paid appears only after the ledger validates the payment."
      />
      <div className="so-card so-card-pad so-embed so-map-frame">
        <MapView />
      </div>
    </>
  );
}

function Certificate({
  receipt,
}: {
  readonly receipt: Extract<ReceiptData, { state: 'receipt' }>;
}) {
  return (
    <div className="so-certificate">
      <div className="so-cert-hdr">
        <div>
          <div className="so-eyebrow teal">SignOff · Payment record</div>
          <h2>
            Certificate of Testnet
            <br />
            settlement
          </h2>
          <p className="so-lede">
            A payment authorised by two independent signatures and validated on XRPL Testnet.
          </p>
        </div>
        <span className="so-cert-stamp" aria-hidden="true">
          ✓
        </span>
      </div>
      <div className="so-cert-proof">
        <div>
          <small>Invoice</small>
          <b className="so-mono">{receipt.invoiceRef}</b>
        </div>
        <div>
          <small>Amount settled</small>
          <b>
            {receipt.amount} {receipt.currency}
          </b>
        </div>
        <div>
          <small>Delivered on the ledger</small>
          <b>
            {receipt.deliveredValue} {receipt.asset}
          </b>
        </div>
        <div>
          <small>Ledger index</small>
          <b className="so-mono">{String(receipt.ledgerIndex)}</b>
        </div>
        <div>
          <small>Network</small>
          <b>XRPL Testnet, not mainnet</b>
        </div>
        <div>
          <small>Rand payout to supplier</small>
          <b>{receipt.rand === null ? 'Not shown' : `${receipt.rand.amount} (SIMULATED)`}</b>
        </div>
      </div>
      <div className="so-signature-pair">
        <div className="so-signature-card">
          <div className="so-smallcaps">Proposal</div>
          <div className="so-signature-line">Agent</div>
          <b>Agent signature</b>
          <small>Cannot pay alone</small>
        </div>
        <div className="so-signature-card">
          <div className="so-smallcaps">Independent authorization</div>
          <div className="so-signature-line">Warden</div>
          <b>Warden co-signature</b>
          <small>Only after every rule passes</small>
        </div>
      </div>
      <p className="so-cert-foot">
        <a
          className="so-btn so-btn-primary"
          href={receipt.explorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          Check it on the public ledger ↗
        </a>
      </p>
      <p className="so-micro">
        Ledger proof is verifiable. A bank payout is not: any rand payout is simulated until a
        licensed partner confirms delivery.
      </p>
    </div>
  );
}

function Receipts({ desk }: { readonly desk: DeskState }) {
  const { data } = desk;
  if (data === null) {
    return <Loading desk={desk} />;
  }
  const paid = data.rows.filter((row) => row.displayState === 'Paid' && row.attemptId !== null);
  const receipt = desk.receipt;
  return (
    <>
      <PageHeader
        eyebrow="Payment completion / verifiable receipts"
        title="Proof, not just a green tick."
        lede="Paid means validated on the ledger and reconciled. Each receipt re-reads the transaction from XRPL Testnet."
      />
      <div className="so-receipt-canvas">
        <section className="so-card so-card-pad">
          {desk.receiptId === null ? (
            <div className="so-empty">
              <div className="so-rule-glyph" aria-hidden="true">
                ≋
              </div>
              <h2>Choose a paid invoice</h2>
              <p className="so-muted">Its receipt is read from the ledger when you open it.</p>
            </div>
          ) : receipt === null ? (
            <p role="status">{desk.receiptError ?? 'Reading the ledger…'}</p>
          ) : receipt.state === 'receipt' ? (
            <Certificate receipt={receipt} />
          ) : (
            <p role="status" className="so-banner">
              {receipt.message}
            </p>
          )}
        </section>
        <aside className="so-card">
          <div className="so-card-pad so-rule-below">
            <h2>Paid invoices</h2>
            <p className="so-card-sub">Validated on XRPL Testnet and reconciled.</p>
          </div>
          {paid.length === 0 ? (
            <p className="so-card-pad so-muted">Nothing is paid yet.</p>
          ) : (
            paid.map((row) => (
              <button
                type="button"
                key={row.rowId}
                className={`so-run ${desk.receiptId === row.attemptId ? 'selected' : ''}`}
                onClick={() => {
                  if (row.attemptId !== null) {
                    desk.openReceipt(row.attemptId);
                  }
                }}
              >
                <b className="so-mono">{row.invoiceRef}</b>
                <small>
                  {amountOf(row)} · {shortSastOf(row.updatedAt)}
                </small>
                <Pill tone="good">Paid</Pill>
              </button>
            ))
          )}
        </aside>
      </div>
    </>
  );
}

const JOURNEY: readonly (readonly [string, string, string, string])[] = [
  [
    'Invoice received',
    'A fictional supplier invoice arrives by email or the inbox.',
    'Live on Testnet',
    'good',
  ],
  ['Procurement match', 'Purchase order and goods received checked.', 'Live on Testnet', 'good'],
  [
    'Warden authorization',
    'Independent rules approve or hold the proposal.',
    'Live on Testnet',
    'good',
  ],
  ['XRPL settlement', 'RLUSD payment validated with two signatures.', 'Live on Testnet', 'good'],
  [
    'Kwacha in, illustrative rate',
    'A licensed on-ramp partner would be needed.',
    'Simulated',
    'warn',
  ],
  [
    'Rand payout to supplier bank',
    'No real bank transfer happens in this build.',
    'Simulated',
    'warn',
  ],
];

function Trade() {
  return (
    <>
      <PageHeader
        eyebrow="Trade operations / corridor view"
        title="One journey. Two countries."
        lede="Which steps run live on XRPL Testnet, and which still need a licensed local partner."
      />
      <div className="so-trade-layout">
        <div className="so-corridor">
          <div className="so-eyebrow">Illustrative corridor · Zambia to South Africa</div>
          <h2>Lusaka to Cape Town.</h2>
          <p>
            A Lusaka buyer pays a Cape Town supplier. SignOff protects the decision to pay; the
            ledger proves the settlement; the last step to a bank account is simulated.
          </p>
          <svg
            className="so-map-panel"
            viewBox="0 0 700 300"
            role="img"
            aria-label="Payment corridor from Lusaka to Cape Town. Not a navigation map."
          >
            <defs>
              <linearGradient id="so-path">
                <stop stopColor="#a5dec5" />
                <stop offset="1" stopColor="#e0cc9f" />
              </linearGradient>
            </defs>
            <path d="M470 70 Q330 120 170 240" fill="none" stroke="url(#so-path)" strokeWidth="3" />
            <circle cx="470" cy="70" r="9" fill="#a5dec5" />
            <circle cx="470" cy="70" r="18" fill="none" stroke="#a5dec5" opacity=".5" />
            <circle cx="170" cy="240" r="9" fill="#dfd0ad" />
            <circle cx="170" cy="240" r="18" fill="none" stroke="#dfd0ad" opacity=".5" />
            <text x="492" y="66" fontSize="15" fill="#edf4ff" fontWeight="700">
              Lusaka
            </text>
            <text x="492" y="86" fontSize="11" fill="#b7cce0">
              Zambia · buyer pays
            </text>
            <text x="40" y="236" fontSize="15" fill="#edf4ff" fontWeight="700">
              Cape Town
            </text>
            <text x="40" y="256" fontSize="11" fill="#b7cce0">
              South Africa · supplier
            </text>
            <text x="300" y="140" fontSize="11" fill="#c4d4e2">
              RLUSD on XRPL Testnet
            </text>
            <text x="300" y="156" fontSize="10" fill="#849bae">
              ledger proof ≠ bank payout
            </text>
          </svg>
          <div className="so-corridor-foot">
            <span>ZM · Buyer funding simulated</span>
            <span>XRPL Testnet · RLUSD</span>
            <span>ZA · Rand payout simulated</span>
          </div>
        </div>
        <div className="so-card so-card-pad">
          <h2>Journey milestones</h2>
          {JOURNEY.map(([title, text, label, tone], index) => (
            <div className={`so-journey-step ${tone === 'warn' ? 'simulated' : ''}`} key={title}>
              <span className="so-step-num">{tone === 'good' ? '✓' : String(index + 1)}</span>
              <div>
                <b>{title}</b>
                <small>{text}</small>
              </div>
              <Pill tone={tone}>{label}</Pill>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const DATE_SAST = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function pageFromHash(): PageId {
  const id = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return PAGES.some(([page]) => page === id) ? (id as PageId) : 'overview';
}

export interface StudioProps {
  readonly session: SessionInfo;
  readonly onSession: (session: SessionInfo) => void;
  readonly onSignOut: () => void;
}

/**
 * The console in the SignOff studio design: a sidebar of pages over one shared desk state. Every page reads the same
 * console API; nothing here decides a payment state.
 */
export function Studio({ session, onSession, onSignOut }: StudioProps) {
  const desk = useDesk(session, onSession);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = (): void => {
      setPage(pageFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const go = (next: PageId): void => {
    setPage(next);
    setMenuOpen(false);
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
    window.scrollTo(0, 0);
  };

  const data = desk.data;
  const attention =
    data === null
      ? 0
      : count(data, 'Held') + count(data, 'Needs a person') + count(data, 'Quarantined');
  const label = PAGES.find(([id]) => id === page)?.[1] ?? 'Overview';
  const live = data?.mode === 'live';

  return (
    <div className="so-app">
      <a href="#so-content" className="so-skip">
        Skip to content
      </a>
      <div className="so-shell">
        <aside className={`so-sidebar ${menuOpen ? 'open' : ''}`} aria-label="Primary navigation">
          <div className="so-brand">
            <span className="so-emblem" aria-hidden="true">
              <svg viewBox="0 0 36 36">
                <path
                  d="M8 11L18 3l11 8-9 7-10-1 11 8-10 8-8-8 9-7z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4.1"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <strong>SignOff</strong>
              <small>Control, before capital.</small>
            </div>
          </div>
          <div className="so-side-label">WORKSPACE</div>
          <nav aria-label="Main pages" className="so-nav">
            {PAGES.map(([id, text, glyph]) => (
              <button
                type="button"
                key={id}
                className={`so-nav-btn ${page === id ? 'active' : ''}`}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => {
                  go(id);
                }}
              >
                <span className="so-glyph" aria-hidden="true">
                  {glyph}
                </span>
                <span>{text}</span>
                {id === 'payments' && attention > 0 ? (
                  <span className="so-count">{attention}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="so-side-label gap">SYSTEM</div>
          <div className="so-side-helper">
            <span className="so-help-shield" aria-hidden="true">
              ◇
            </span>
            <div>
              <b>Independent Warden</b>
              <span>
                {data === null
                  ? 'Connecting…'
                  : data.overview.paused
                    ? 'Paused: no new payments'
                    : 'Running · rules ' + data.overview.policyVersion}
              </span>
            </div>
            <span
              className={`so-side-live ${data?.overview.paused === true ? 'paused' : ''}`}
              aria-hidden="true"
            >
              ●
            </span>
          </div>
          <div className="so-side-bottom">
            <div className="so-side-line" />
            <div className="so-side-notice">
              {live ? 'LIVE DEMO' : 'SIMULATED REPLAY'}
              <b>XRPL Testnet · Fictional data</b>
              <span>Testnet RLUSD has no value. Bank payouts are simulated.</span>
            </div>
            <div className="so-profile">
              <span className="so-avatar">{initialsOf(session.username)}</span>
              <div>
                <b>{session.username}</b>
                <small>{session.role === 'operator' ? 'Operator' : 'Viewer'}</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="so-main">
          <header className="so-topbar">
            <button
              type="button"
              className="so-iconbtn so-mobile-menu"
              aria-label="Open navigation"
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
            >
              ☰
            </button>
            <div className="so-top-left">
              <span className="so-company" aria-hidden="true">
                ◈
              </span>
              <span>Lusaka Solar Distribution</span>
              <span className="so-top-dot">/</span>
              <b>{label}</b>
            </div>
            <div className="so-top-right">
              <span className={`so-env-chip ${live ? '' : 'sim'}`}>
                <i />
                {live ? 'LIVE · XRPL TESTNET' : 'SIMULATED REPLAY'}
              </span>
              <span className="so-top-date">{DATE_SAST.format(new Date()).toUpperCase()}</span>
              <button type="button" className="so-btn so-btn-small" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </header>
          <main id="so-content" className="so-page" tabIndex={-1}>
            {page === 'overview' ? <Overview desk={desk} go={go} /> : null}
            {page === 'payments' ? <Payments desk={desk} /> : null}
            {page === 'evidence' ? <Evidence desk={desk} go={go} /> : null}
            {page === 'warden' ? <Warden desk={desk} /> : null}
            {page === 'map' ? <AgentMapPage /> : null}
            {page === 'receipts' ? <Receipts desk={desk} /> : null}
            {page === 'trade' ? <Trade /> : null}
          </main>
          <footer className="so-footer">
            <span>SignOff · XRPL Testnet · All business records fictional</span>
            <span>AI proposes. Warden decides. Ledger proves.</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
