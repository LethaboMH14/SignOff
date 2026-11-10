import type { ReceiptView as ReceiptData } from '../src/server/receipt.js';
import { StateChip } from './StateChip.js';

export interface ReceiptViewProps {
  readonly receipt: ReceiptData | null;
  readonly error: string | null;
  readonly onBack: () => void;
}

/**
 * The receipt for a paid payment: the explorer link, the amount the ledger delivered, the asset's name, and a rand figure
 * only when it is labelled SIMULATED. Where the ledger does not confirm the payment, no receipt is shown.
 */
export function ReceiptView({ receipt, error, onBack }: ReceiptViewProps) {
  return (
    <section className="receipt" aria-labelledby="receipt-title">
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
      {receipt === null ? (
        error === null ? (
          <p role="status">Checking the ledger…</p>
        ) : null
      ) : receipt.state === 'receipt' ? (
        <>
          <h2 id="receipt-title">Receipt for invoice {receipt.invoiceRef}</h2>
          <p>
            <StateChip state="Paid" /> Validated on the ledger and reconciled.
          </p>
          <dl className="facts">
            <div>
              <dt>Amount settled</dt>
              <dd>
                {receipt.amount} {receipt.currency}
              </dd>
            </div>
            <div>
              <dt>Delivered on the ledger</dt>
              <dd>
                {receipt.deliveredValue} ({receipt.asset})
              </dd>
            </div>
            <div>
              <dt>Ledger index</dt>
              <dd>{String(receipt.ledgerIndex)}</dd>
            </div>
          </dl>
          <p>
            <a href={receipt.explorerUrl} target="_blank" rel="noopener noreferrer">
              Open the transaction on the Testnet explorer
            </a>
          </p>
          {receipt.rand === null ? null : (
            <p className="notice">
              <strong>{receipt.rand.label}</strong>: about R{receipt.rand.amount} at a placeholder
              rate of {receipt.rand.rate} per unit. No market rate is claimed.
            </p>
          )}
        </>
      ) : (
        <>
          <h2 id="receipt-title">No receipt yet</h2>
          <p className="notice">{receipt.message}</p>
        </>
      )}
    </section>
  );
}
