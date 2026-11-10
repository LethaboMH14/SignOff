import { type SubmitEvent, useState } from 'react';

import { type DeskData } from './api.js';
import { DISPLAY_STATES, type DisplayState } from '../src/model/desk.js';
import { StateChip } from './StateChip.js';

/** The headline states, in the order the desk reads them. The rest are in the queue and in the count below. */
export const HEADLINE_STATES: readonly DisplayState[] = [
  'Paid',
  'In progress',
  'Held',
  'Needs a person',
  'Not confirmed',
  'Refused',
];

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

/** The count for one state. Missing states count as zero. */
export function countOf(
  counts: Readonly<Record<DisplayState, number>>,
  state: DisplayState,
): number {
  return new Map<string, number>(Object.entries(counts)).get(state) ?? 0;
}

export interface DeskViewProps {
  readonly data: DeskData | null;
  readonly error: string | null;
  readonly busy: boolean;
  /** Set while a pause or resume waits for the password to be confirmed. */
  readonly waitingFor: boolean | null;
  readonly onTogglePause: () => void;
  readonly onConfirm: (password: string) => Promise<void>;
  readonly onCancelConfirm: () => void;
  /** Opens the held-invoice view for a row. */
  readonly onOpen: (rowId: string) => void;
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
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The payment desk. It only shows what the console API gave it; nothing here decides a payment state. */
export function DeskView(props: DeskViewProps) {
  const { data, error, busy, waitingFor } = props;
  if (data === null) {
    return (
      <section className="desk" aria-label="Payment desk">
        <p role="status">{error ?? 'Loading the desk…'}</p>
      </section>
    );
  }
  const { overview } = data;
  return (
    <section className="desk" aria-label="Payment desk">
      {error === null ? null : (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <p className="mode-label" role="status">
        {data.mode === 'simulated'
          ? 'SIMULATED: replay of a labelled run. Nothing here moved real money.'
          : 'Live run on Testnet. Test-issued token, not RLUSD.'}
      </p>

      <ul className="tiles" aria-label="Counts by state">
        {HEADLINE_STATES.map((state) => (
          <li key={state} className="tile">
            <p className="tile-number">{String(countOf(data.counts, state))}</p>
            <p className="tile-label">
              <StateChip state={state} />
            </p>
          </li>
        ))}
      </ul>

      <section className="panel warden" aria-labelledby="warden-title">
        <h2 id="warden-title">Warden</h2>
        <p>
          <strong>{overview.paused ? 'Payments are paused.' : 'Payments are running.'}</strong>{' '}
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
        {overview.pendingLimitChange === null ? null : (
          <p className="notice">
            A raised limit is waiting for a second operator. It expires{' '}
            {sastOf(overview.pendingLimitChange.expiresAt)}.
          </p>
        )}
        {waitingFor === null ? (
          <button type="button" disabled={busy} onClick={props.onTogglePause}>
            {overview.paused ? 'Resume payments' : 'Pause new payments'}
          </button>
        ) : (
          <StepUp busy={busy} onConfirm={props.onConfirm} onCancel={props.onCancelConfirm} />
        )}
      </section>

      <section className="panel queue-panel" aria-labelledby="queue-title">
        <h2 id="queue-title">Queue</h2>
        {data.rows.length === 0 ? (
          <p>Nothing has been proposed or held yet.</p>
        ) : (
          <ol className="queue">
            {data.rows.map((row) => (
              <li key={row.rowId} className="row">
                <p className="row-head">
                  <StateChip state={row.displayState} />
                  <span className="row-ref">Invoice {row.invoiceRef}</span>
                </p>
                <p className="row-amount">
                  {row.amountMinor === null
                    ? 'Amount not recorded'
                    : moneyOf(row.amountMinor, row.currency)}
                </p>
                <p className="row-reason">
                  {row.reasonCode === null ? null : <code>{row.reasonCode}</code>} {row.reason}
                </p>
                {row.modelCalls === null ? null : (
                  <p className="row-model">Model calls: {String(row.modelCalls)} of at most 3</p>
                )}
                <p className="row-time">Updated {sastOf(row.updatedAt)}</p>
                <p>
                  <button
                    type="button"
                    className="open"
                    aria-label={`Open invoice ${row.invoiceRef}`}
                    onClick={() => {
                      props.onOpen(row.rowId);
                    }}
                  >
                    Open
                  </button>
                </p>
              </li>
            ))}
          </ol>
        )}
        <p className="counts-line">
          {DISPLAY_STATES.map((state) => `${state} ${String(countOf(data.counts, state))}`).join(
            ' · ',
          )}
        </p>
      </section>
    </section>
  );
}
