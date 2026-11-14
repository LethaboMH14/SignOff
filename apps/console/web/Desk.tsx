import type { SessionInfo } from './api.js';
import { DeskView, type DeskTab } from './DeskView.js';
import { InvoiceView } from './InvoiceView.js';
import { ReceiptView } from './ReceiptView.js';
import { type DeskState, useDesk } from './useDesk.js';

export interface DeskProps {
  readonly session: SessionInfo;
  readonly onSession: (session: SessionInfo) => void;
}

export interface DeskPanelProps {
  readonly desk: DeskState;
  /** The tab the desk opens on. */
  readonly initialTab?: DeskTab;
  /** Shows the desk even when an invoice or a receipt is open elsewhere. */
  readonly deskOnly?: boolean;
}

/**
 * The payment desk for a shared desk state: the desk itself, or the held-invoice view or the receipt when one is open.
 */
export function DeskPanel({ desk, initialTab, deskOnly = false }: DeskPanelProps) {
  if (!deskOnly && desk.receiptId !== null) {
    return (
      <ReceiptView receipt={desk.receipt} error={desk.receiptError} onBack={desk.closeReceipt} />
    );
  }
  if (!deskOnly && desk.openId !== null) {
    return <InvoiceView detail={desk.detail} error={desk.detailError} onBack={desk.closeInvoice} />;
  }
  return (
    <DeskView
      data={desk.data}
      error={desk.error}
      busy={desk.busy}
      pending={desk.pending}
      {...(initialTab === undefined ? {} : { initialTab })}
      onTogglePause={desk.onTogglePause}
      onRequestLimits={desk.onRequestLimits}
      onApprove={desk.onApprove}
      onConfirm={desk.onConfirm}
      onCancelConfirm={desk.onCancelConfirm}
      onOpen={desk.openInvoice}
      onReceipt={desk.openReceipt}
      onSendTestInvoice={desk.onSendTestInvoice}
    />
  );
}

/** The desk with its own state, for a page that shows only the desk. */
export function Desk({ session, onSession }: DeskProps) {
  const desk = useDesk(session, onSession);
  return <DeskPanel desk={desk} />;
}
