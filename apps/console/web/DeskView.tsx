import { type SubmitEvent, useState } from 'react';

import { type DeskData, type LimitValues, type PendingAction } from './api.js';
import { DISPLAY_STATES, type DeskRow, type DisplayState } from '../src/model/desk.js';
import { limitChangeOf, limitEffectOf, limitSymbolOf } from '../src/model/limits.js';
import { nextActionOf } from '../src/model/next-action.js';
import { AgentFlow } from './Brand.js';
import { CountUp } from './CountUp.js';
import { slugOf, StateChip, symbolOf } from './StateChip.js';

/** The headline states, in the order the desk reads them. The rest are in the history and in the count below. */
export const HEADLINE_STATES: readonly DisplayState[] = [
  'Paid',
  'In progress',
  'Held',
  'Needs a person',
  'Not confirmed',
  'Refused',
];

/** The states that need a person to look at them. */
const ATTENTION: readonly DisplayState[] = ['Held', 'Needs a person'];

/**
 * The three sections of the desk. The counts above the tabs stay in view on every one of them.
 */
export type DeskTab = 'queue' | 'invoices' | 'warden';

export const DESK_TABS: readonly { readonly id: DeskTab; readonly label: string }[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'warden', label: 'Warden and limits' },
];

/**
 * The tab that a key moves to, following the tab pattern: arrows wrap around, Home and End go to the ends. Any other key
 * moves nothing.
 */
export function tabAfter(current: DeskTab, key: string): DeskTab | null {
  const index = DESK_TABS.findIndex((tab) => tab.id === current);
  const last = DESK_TABS.length - 1;
  let next: number;
  switch (key) {
    case 'ArrowRight':
      next = index === last ? 0 : index + 1;
      break;
    case 'ArrowLeft':
      next = index === 0 ? last : index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = last;
      break;
    default:
      return null;
  }
  return DESK_TABS.at(next)?.id ?? null;
}

/**
 * An amount in minor units, shown with two decimals in the usual international form (1,250.00). The currency comes from
 * the row, never guessed.
 */
export function moneyOf(minor: number, currency: string | null): string {
  const major = (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === null ? major : `${major} ${currency}`;
}

/** A time shown in South African time, the time the operators work in. */
export function sastOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'time not recorded';
  }
  return date.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** A short South African time for a card: day, month and clock, with no year, so it stays on one line. */
export function shortSastOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'time not recorded';
  }
  return date.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** The count for one state. Missing states count as zero. */
export function countOf(
  counts: Readonly<Record<DisplayState, number>>,
  state: DisplayState,
): number {
  return new Map<string, number>(Object.entries(counts)).get(state) ?? 0;
}

/** A limit in minor units, written as an amount to type: 5000.00. */
export function majorTextOf(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** The minor units for an amount typed as 5000 or 5000.00, or null when it is not a positive amount. */
export function minorOf(text: string): number | null {
  const trimmed = text.trim();
  const [whole = '', fraction = '', ...rest] = trimmed.split('.');
  const digits = (value: string): boolean => /^[0-9]*$/.test(value);
  if (
    rest.length > 0 ||
    whole.length === 0 ||
    whole.length > 10 ||
    fraction.length > 2 ||
    !digits(whole) ||
    !digits(fraction)
  ) {
    return null;
  }
  const minor = Math.round(Number(trimmed) * 100);
  return minor > 0 ? minor : null;
}

/**
 * The invoice the desk puts in front of the operator: the first one that needs a person, otherwise the first one in the
 * queue. Nothing here decides a payment; it only chooses what to show first.
 */
export function featuredOf(rows: readonly DeskRow[]): DeskRow | null {
  return rows.find((row) => ATTENTION.includes(row.displayState)) ?? rows[0] ?? null;
}

/** The invoices that come after the featured one in the queue, at most three. */
export function nextRowsOf(rows: readonly DeskRow[], featured: DeskRow | null): readonly DeskRow[] {
  return rows.filter((row) => row !== featured).slice(0, 3);
}

/** A state's symbol in a circle. It is decoration: the state's words are always printed beside it. */
function StateSymbol({ state }: { readonly state: DisplayState }) {
  return (
    <span className={`symbol chip-${slugOf(state)}`} aria-hidden="true">
      {symbolOf(state)}
    </span>
  );
}

export interface DeskViewProps {
  readonly data: DeskData | null;
  readonly error: string | null;
  readonly busy: boolean;
  /** The change waiting for the password to be confirmed, or null when nothing is waiting. */
  readonly pending: PendingAction | null;
  readonly onTogglePause: () => void;
  readonly onRequestLimits: (values: LimitValues) => void;
  readonly onApprove: (requestId: string) => void;
  readonly onConfirm: (password: string) => Promise<void>;
  readonly onCancelConfirm: () => void;
  /** Opens the held-invoice view for a row. */
  readonly onOpen: (rowId: string) => void;
  /** Opens the receipt for a paid row, by its attempt id. */
  readonly onReceipt: (attemptId: string) => void;
  /** Drops a fictional test invoice into the agent's inbox. Present only when the demo launcher started the console. */
  readonly onSendTestInvoice?: (zarMinor: number) => Promise<string>;
}

/**
 * The demo's own invoice button. It writes a fictional supplier's invoice, with its order and goods receipt, so the
 * operator can watch one invoice travel from inbox to testnet payment without leaving the browser.
 */
export function TestInvoicePanel({
  onSend,
}: {
  readonly onSend: (zarMinor: number) => Promise<string>;
}) {
  const [amount, setAmount] = useState('20.00');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const zarMinor = minorOf(amount);
    if (zarMinor === null || zarMinor < 100 || zarMinor > 1_000_000) {
      setMessage('Enter an amount from R1.00 to R10,000.00.');
      return;
    }
    setSending(true);
    try {
      setMessage(await onSend(zarMinor));
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'The test invoice was not sent.');
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="panel test-invoice" aria-labelledby="test-invoice-title">
      <h2 id="test-invoice-title">Send a test invoice</h2>
      <p className="muted">
        Testnet demo. A fictional supplier invoice, with its purchase order and goods receipt, goes
        into the agent&apos;s inbox.
      </p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label>
          Amount in rand
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </label>
        <button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send test invoice'}
        </button>
      </form>
      {message === null ? null : <p role="status">{message}</p>}
    </section>
  );
}

function StepUp({
  onConfirm,
  onCancel,
  busy,
}: {
  readonly onConfirm: (password: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly busy: boolean;
}) {
  const [password, setPassword] = useState('');
  return (
    <form
      className="stepup"
      aria-label="Confirm your password"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onCancel();
        }
      }}
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        void onConfirm(password).then(() => {
          setPassword('');
        });
      }}
    >
      <p>Confirm your password to make this change.</p>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </label>
      <div className="actions">
        <button type="submit" disabled={busy}>
          Confirm and continue
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export interface CurrentLimits {
  readonly perPaymentMinor: number;
  readonly supplierDailyMinor: number;
  readonly dailyTotalMinor: number;
}

/**
 * One limit field: the label, the amount typed, and the effect of the change in words beside it. The effect is shown as
 * a symbol and words, so it does not depend on colour.
 */
function LimitField({
  name,
  label,
  current,
  text,
  onText,
}: {
  readonly name: string;
  readonly label: string;
  readonly current: number;
  readonly text: string;
  readonly onText: (text: string) => void;
}) {
  const requested = minorOf(text);
  const change = requested === null ? null : limitChangeOf(current, requested);
  const effectId = `${name}-effect`;
  return (
    <div className="limit-field">
      <label>
        {label}
        <span className="limit-current">Now {moneyOf(current, null)}</span>
        <input
          name={name}
          inputMode="decimal"
          value={text}
          aria-describedby={effectId}
          onChange={(event) => {
            onText(event.target.value);
          }}
        />
      </label>
      <small id={effectId} className={`limit-effect limit-${change ?? 'unknown'}`}>
        <span aria-hidden="true">{change === null ? '?' : limitSymbolOf(change)}</span>{' '}
        {limitEffectOf(change)}
      </small>
    </div>
  );
}

/** The limits form. A lower limit applies at once; a higher one waits for a second operator. */
export function LimitsForm({
  current,
  busy,
  onSubmit,
}: {
  readonly current: CurrentLimits;
  readonly busy: boolean;
  readonly onSubmit: (values: LimitValues) => void;
}) {
  const [perPayment, setPerPayment] = useState(majorTextOf(current.perPaymentMinor));
  const [perSupplier, setPerSupplier] = useState(majorTextOf(current.supplierDailyMinor));
  const [total, setTotal] = useState(majorTextOf(current.dailyTotalMinor));
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="limits-form"
      aria-label="Change limits"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const values = {
          perPaymentMinor: minorOf(perPayment),
          supplierDailyMinor: minorOf(perSupplier),
          dailyTotalMinor: minorOf(total),
        };
        if (
          values.perPaymentMinor === null ||
          values.supplierDailyMinor === null ||
          values.dailyTotalMinor === null
        ) {
          setProblem('Enter each limit as an amount, such as 5000.00.');
          return;
        }
        setProblem(null);
        onSubmit({
          perPaymentMinor: values.perPaymentMinor,
          supplierDailyMinor: values.supplierDailyMinor,
          dailyTotalMinor: values.dailyTotalMinor,
        });
      }}
    >
      <p className="limits-rule">
        <b>Lower</b> a limit and it applies at once. <b>Raise</b> a limit and a second operator must
        approve it.
      </p>
      <LimitField
        name="perPayment"
        label="Per payment"
        current={current.perPaymentMinor}
        text={perPayment}
        onText={setPerPayment}
      />
      <LimitField
        name="perSupplier"
        label="Per supplier, per day"
        current={current.supplierDailyMinor}
        text={perSupplier}
        onText={setPerSupplier}
      />
      <LimitField
        name="total"
        label="Total, per day"
        current={current.dailyTotalMinor}
        text={total}
        onText={setTotal}
      />
      {problem === null ? null : (
        <p role="alert" className="notice">
          {problem}
        </p>
      )}
      <button type="submit" disabled={busy}>
        Ask for these limits
      </button>
    </form>
  );
}

/**
 * The payment desk. A summary strip of counts stays at the top; three tabs hold the queue, the invoice history and the
 * Warden with its limits. It only shows what the console API gave it; nothing here decides a payment state.
 */
export function DeskView(props: DeskViewProps) {
  const { data, error, busy, pending } = props;
  const [tab, setTab] = useState<DeskTab>('queue');
  if (data === null) {
    return (
      <section className="desk" aria-label="Payment desk">
        <p role="status">{error ?? 'Loading the desk…'}</p>
      </section>
    );
  }
  const { overview, rows } = data;
  const raise = overview.pendingLimitChange;
  const featured = featuredOf(rows);
  const next = nextRowsOf(rows, featured);
  const featuredHeld = featured !== null && ATTENTION.includes(featured.displayState);
  const attention = countOf(data.counts, 'Held') + countOf(data.counts, 'Needs a person');

  const countFor = (id: DeskTab): number | null => {
    if (id === 'queue') {
      return attention;
    }
    return id === 'invoices' ? rows.length : null;
  };

  const choose = (id: DeskTab): void => {
    setTab(id);
    document.getElementById(`desk-tab-${id}`)?.focus();
  };

  return (
    <section className="desk" aria-label="Payment desk">
      {error === null ? null : (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <p className="mode-label" role="status">
        <span className="mode-dot" aria-hidden="true" />
        {data.mode === 'simulated'
          ? 'SIMULATED: replay of a labelled run. Nothing here moved real money.'
          : 'Live run on Testnet. Test tokens with no real value.'}
      </p>

      <ul className="tiles" aria-label="Counts by state">
        {HEADLINE_STATES.map((state) => (
          <li key={state} className={`tile tile-${slugOf(state)}`}>
            <p className="tile-number">
              <CountUp value={countOf(data.counts, state)} />
            </p>
            <p className="tile-label">
              <StateChip state={state} />
            </p>
          </li>
        ))}
      </ul>

      <div className="desk-tabs" role="tablist" aria-label="Desk sections">
        {DESK_TABS.map((item) => {
          const selected = tab === item.id;
          const count = countFor(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`desk-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`desk-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'desk-tab on' : 'desk-tab'}
              onClick={() => {
                setTab(item.id);
              }}
              onKeyDown={(event) => {
                const target = tabAfter(item.id, event.key);
                if (target !== null) {
                  event.preventDefault();
                  choose(target);
                }
              }}
            >
              <span>{item.label}</span>
              {count === null ? null : <span className="desk-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="desk-panel-queue"
        aria-labelledby="desk-tab-queue"
        className="desk-panel"
        hidden={tab !== 'queue'}
      >
        <div className="queue-layout">
          <div className="queue-main">
            {data.testInvoices === true && props.onSendTestInvoice !== undefined ? (
              <TestInvoicePanel onSend={props.onSendTestInvoice} />
            ) : null}
            {featured === null ? (
              <section className="panel" aria-labelledby="featured-title">
                <h2 id="featured-title">No invoice yet</h2>
                <p>The first invoice appears here once the agent proposes it.</p>
              </section>
            ) : (
              <section
                className={`panel featured accent-${slugOf(featured.displayState)}`}
                aria-labelledby="featured-title"
              >
                <div className="featured-head">
                  <StateSymbol state={featured.displayState} />
                  <div>
                    <h2 id="featured-title">Invoice {featured.invoiceRef}</h2>
                    <StateChip state={featured.displayState} />
                  </div>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Amount</dt>
                    <dd>
                      {featured.amountMinor === null
                        ? 'Amount not recorded'
                        : moneyOf(featured.amountMinor, featured.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{sastOf(featured.updatedAt)}</dd>
                  </div>
                </dl>
                <div className="actions">
                  <button
                    type="button"
                    aria-label={`Open evidence for invoice ${featured.invoiceRef}`}
                    onClick={() => {
                      props.onOpen(featured.rowId);
                    }}
                  >
                    Open evidence
                  </button>
                  {featured.displayState === 'Paid' && featured.attemptId !== null ? (
                    <button
                      type="button"
                      className="quiet"
                      aria-label={`Open receipt for invoice ${featured.invoiceRef}`}
                      onClick={() => {
                        props.onReceipt(featured.attemptId ?? '');
                      }}
                    >
                      Receipt
                    </button>
                  ) : null}
                </div>
              </section>
            )}

            <section className="panel" aria-labelledby="why-title">
              <h2 id="why-title">{featuredHeld ? 'Why it is held' : 'Status'}</h2>
              {featured === null ? (
                <p>Nothing is held.</p>
              ) : featuredHeld ? (
                <>
                  <p>
                    {featured.reasonCode === null ? null : <code>{featured.reasonCode}</code>}{' '}
                    {featured.reason}
                  </p>
                  {featured.reasonCode === null ? null : (
                    <p className="next-step">
                      <b>Next step.</b> {nextActionOf(featured.reasonCode)}
                    </p>
                  )}
                </>
              ) : (
                <p>{featured.reason}</p>
              )}
            </section>

            <section className="panel" aria-labelledby="next-title">
              <h2 id="next-title">Next in the queue</h2>
              {next.length === 0 ? (
                <p className="muted">No other invoices are waiting.</p>
              ) : (
                <ul className="next-list">
                  {next.map((row) => (
                    <li key={row.rowId}>
                      <span>Invoice {row.invoiceRef}</span>
                      <StateChip state={row.displayState} />
                    </li>
                  ))}
                </ul>
              )}
              <p>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setTab('invoices');
                  }}
                >
                  See every invoice
                </button>
              </p>
            </section>
          </div>

          <div className="queue-side">
            <section className="panel hero" aria-labelledby="flow-title">
              <h2 id="flow-title">How an invoice moves</h2>
              <AgentFlow />
              <p className="lede">
                An invoice moves from left to right. Warden checks the rules before it adds the
                second signature. Paid appears only after the ledger validates the payment.
              </p>
            </section>
          </div>
        </div>
      </div>

      <div
        role="tabpanel"
        id="desk-panel-invoices"
        aria-labelledby="desk-tab-invoices"
        className="desk-panel"
        hidden={tab !== 'invoices'}
      >
        <section className="panel" id="invoice-history" aria-labelledby="history-title">
          <div className="panel-head">
            <h2 id="history-title">Invoice history</h2>
            <p className="counts-line">
              {DISPLAY_STATES.map(
                (state) => `${state} ${String(countOf(data.counts, state))}`,
              ).join(' · ')}
            </p>
          </div>
          {rows.length === 0 ? (
            <p>Nothing has been proposed or held yet.</p>
          ) : (
            <ol className="history">
              {rows.map((row) => (
                <li key={row.rowId} className={`history-card state-${slugOf(row.displayState)}`}>
                  <div className="history-head">
                    <b className="history-ref">Invoice {row.invoiceRef}</b>
                    <StateChip state={row.displayState} />
                  </div>
                  <div className="history-facts">
                    <span className="history-amount">
                      {row.amountMinor === null
                        ? 'Amount not recorded'
                        : moneyOf(row.amountMinor, row.currency)}
                    </span>
                    <time className="history-time" dateTime={row.updatedAt}>
                      {shortSastOf(row.updatedAt)}
                    </time>
                  </div>
                  <p className="history-reason">
                    {row.reasonCode === null ? null : <code>{row.reasonCode}</code>} {row.reason}
                    {row.modelCalls === null
                      ? null
                      : ` · Model calls: ${String(row.modelCalls)} of at most 3`}
                  </p>
                  <div className="history-actions">
                    <button
                      type="button"
                      className="quiet"
                      aria-label={`Open invoice ${row.invoiceRef}`}
                      onClick={() => {
                        props.onOpen(row.rowId);
                      }}
                    >
                      Open
                    </button>
                    {row.displayState !== 'Paid' || row.attemptId === null ? null : (
                      <button
                        type="button"
                        aria-label={`Open receipt for invoice ${row.invoiceRef}`}
                        onClick={() => {
                          props.onReceipt(row.attemptId ?? '');
                        }}
                      >
                        Receipt
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div
        role="tabpanel"
        id="desk-panel-warden"
        aria-labelledby="desk-tab-warden"
        className="desk-panel"
        hidden={tab !== 'warden'}
      >
        {pending === null ? null : (
          <StepUp busy={busy} onConfirm={props.onConfirm} onCancel={props.onCancelConfirm} />
        )}
        <div className="control-layout">
          <section className="panel" aria-labelledby="warden-title">
            <h2 id="warden-title">Warden</h2>
            <p className="muted">
              Rules version {overview.policyVersion}. Usage today{' '}
              {moneyOf(overview.usageToday.totalMinor, null)}.
            </p>
            <dl className="limits">
              <div>
                <dt>Per payment</dt>
                <dd>{moneyOf(overview.limits.perPaymentMinor, null)}</dd>
              </div>
              <div>
                <dt>Per supplier, per day</dt>
                <dd>{moneyOf(overview.limits.supplierDailyMinor, null)}</dd>
              </div>
              <div>
                <dt>Total, per day</dt>
                <dd>{moneyOf(overview.limits.dailyTotalMinor, null)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="payments-title">
            <h2 id="payments-title">Payments</h2>
            <p>
              <strong>{overview.paused ? 'Payments are paused.' : 'Payments are running.'}</strong>
            </p>
            <p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  props.onTogglePause();
                }}
              >
                {overview.paused ? 'Resume payments' : 'Pause new payments'}
              </button>
            </p>
          </section>

          <section className="panel control-limits" aria-labelledby="limits-title">
            <h2 id="limits-title">Change limits</h2>
            {raise === null ? null : (
              <section className="notice" aria-labelledby="raise-title">
                <h3 id="raise-title">A raised limit is waiting</h3>
                <p>
                  Asked by {raise.requestedBy}. It expires {sastOf(raise.expiresAt)}. Per payment{' '}
                  {moneyOf(raise.perPaymentMinor, null)}; per supplier, per day{' '}
                  {moneyOf(raise.supplierDailyMinor, null)}; total, per day{' '}
                  {moneyOf(raise.dailyTotalMinor, null)}.
                </p>
                <p>
                  <button
                    type="button"
                    disabled={busy || !raise.approvalAllowed}
                    aria-describedby="approve-why"
                    onClick={() => {
                      props.onApprove(raise.requestId);
                    }}
                  >
                    Approve the raised limit
                  </button>
                </p>
                <p id="approve-why">{raise.why}</p>
              </section>
            )}
            <LimitsForm
              current={overview.limits}
              busy={busy}
              onSubmit={(values) => {
                props.onRequestLimits(values);
              }}
            />
          </section>
        </div>
      </div>
    </section>
  );
}
