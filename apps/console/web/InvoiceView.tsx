import { evidenceStagesOf } from '../src/model/evidence-path.js';
import { reasonTextOf } from '../src/model/reasons.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';
import { EvidencePath } from './EvidencePath.js';
import { moneyOf, sastOf } from './DeskView.js';
import { StateChip } from './StateChip.js';

export interface InvoiceViewProps {
  readonly detail: InvoiceDetail | null;
  readonly error: string | null;
  readonly onBack: () => void;
}

/** The first twelve characters of a hash, or a plain statement that none was recorded. */
export function shortHashOf(hash: string | null): string {
  return hash === null ? 'not recorded' : `${hash.slice(0, 12)}…`;
}

/**
 * The held-invoice view: the state, the rule that failed, the next step, the evidence path move by move, the masked
 * payee, the Warden's decision and the payout change. Nothing here changes a payment.
 */
export function InvoiceView({ detail, error, onBack }: InvoiceViewProps) {
  return (
    <section className="invoice" aria-labelledby="invoice-title">
      <p>
        <button type="button" onClick={onBack}>
          Back to the queue
        </button>
      </p>
      {error === null ? null : (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {detail === null ? (
        error === null ? (
          <p role="status">Loading the invoice…</p>
        ) : null
      ) : (
        <>
          <h2 id="invoice-title">Invoice {detail.invoiceRef}</h2>
          <p>
            <StateChip state={detail.displayState} />
          </p>
          <dl className="facts">
            <div>
              <dt>Amount</dt>
              <dd>
                {detail.amountMinor === null
                  ? 'Not recorded'
                  : moneyOf(detail.amountMinor, detail.currency)}
              </dd>
            </div>
            <div>
              <dt>Supplier</dt>
              <dd>{detail.supplierId ?? 'Not matched yet'}</dd>
            </div>
            <div>
              <dt>Enrolled account</dt>
              <dd>{detail.enrolledPayee ?? 'Not known for this invoice'}</dd>
            </div>
          </dl>

          <section className="panel" aria-labelledby="path-stages-title">
            <h3 id="path-stages-title">Payment evidence path</h3>
            <EvidencePath
              label="Payment evidence path for this invoice"
              stages={evidenceStagesOf(detail)}
            />
          </section>

          <section className="panel" aria-labelledby="failed-title">
            <h3 id="failed-title">What failed</h3>
            {detail.failedRule === null ? (
              <p>Nothing failed on this invoice.</p>
            ) : (
              <p>
                <code>{detail.failedRule.code}</code> {detail.failedRule.sentence}
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="next-title">
            <h3 id="next-title">What to do next</h3>
            <p>{detail.nextAction ?? 'No step is needed.'}</p>
          </section>

          {detail.payoutChange === null ? null : (
            <section className="panel" aria-labelledby="payout-title">
              <h3 id="payout-title">Payout change</h3>
              <p>
                Status: <strong>{detail.payoutChange.status}</strong>
              </p>
              <p>
                <button type="button" disabled aria-describedby="approval-why">
                  Approve payout change
                </button>
              </p>
              <p id="approval-why" className="notice">
                Approval is not available in the console. {detail.payoutChange.why}
              </p>
            </section>
          )}

          {detail.wardenDecision === null ? null : (
            <section className="panel" aria-labelledby="warden-title">
              <h3 id="warden-title">The Warden&rsquo;s decision</h3>
              <p>
                {detail.wardenDecision.decision} under rules {detail.wardenDecision.policyVersion}{' '}
                at {sastOf(detail.wardenDecision.evaluatedAt)}.
              </p>
              {detail.wardenDecision.reasonCodes.map((code) => (
                <p key={code}>
                  <code>{code}</code> {reasonTextOf(code)}
                </p>
              ))}
            </section>
          )}

          <section className="panel" aria-labelledby="path-title">
            <h3 id="path-title">Audit timeline</h3>
            <p className="lede">
              Each move is in the order the agent made it. Hashes stand for the invoice file and the
              records it was checked against. No document text is shown.
            </p>
            <ol className="path">
              {detail.history.map((move) => (
                <li key={move.seq} className="move">
                  <p>
                    <strong>{move.stateLabel}</strong> by {move.actorLabel}, {sastOf(move.at)}
                  </p>
                  {move.reasonCode === 'OK' ? null : (
                    <p>
                      <code>{move.reasonCode}</code> {move.reason}
                    </p>
                  )}
                  <p className="row-time">
                    File hash {shortHashOf(move.fileSha256)}; records checked{' '}
                    {String(move.recordSha256s.length)}; rules {move.policyVersion}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </section>
  );
}
