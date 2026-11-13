import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  approveLimit,
  confirmPassword,
  type DeskData,
  type LimitValues,
  loadDesk,
  loadInvoice,
  loadReceipt,
  type PendingAction,
  sendTestInvoice,
  type SessionInfo,
  setLimits,
  setPaused,
} from './api.js';
import { type ActionPorts, confirmAndPerform, performAction, type Settled } from './actions.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';
import { DeskView } from './DeskView.js';
import { InvoiceView } from './InvoiceView.js';
import type { ReceiptView as ReceiptData } from '../src/server/receipt.js';
import { ReceiptView } from './ReceiptView.js';

/** How often the desk asks the console for fresh rows. A change also refreshes at once. */
const REFRESH_MS = 5000;

/** The console calls for changes. Each is the function the API client exports. */
const PORTS: ActionPorts = {
  pause: setPaused,
  limits: setLimits,
  approve: approveLimit,
  confirm: confirmPassword,
};

function messageOf(failure: unknown): string {
  return failure instanceof ApiError ? failure.message : 'The desk did not load. Try again.';
}

export interface DeskProps {
  readonly session: SessionInfo;
  readonly onSession: (session: SessionInfo) => void;
}

/**
 * The desk with its state. It reads the console API. A pause, a limit change or an approval that the console refuses
 * for want of a recent password waits; the password is asked for; the same change is then sent again.
 */
export function Desk({ session, onSession }: DeskProps) {
  const [data, setData] = useState<DeskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The change waiting for the password, or null when nothing is waiting. */
  const [pending, setPending] = useState<PendingAction | null>(null);
  /** The invoice whose held-invoice view is open, and its detail once it has loaded. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  /** The payment whose receipt is open, and the receipt once the console has answered. */
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const openInvoice = useCallback(async (rowId: string) => {
    setOpenId(rowId);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(await loadInvoice(rowId));
    } catch (failure) {
      setDetailError(
        failure instanceof ApiError ? failure.message : 'The invoice did not load. Try again.',
      );
    }
  }, []);

  const openReceipt = useCallback(async (attemptId: string) => {
    setReceiptId(attemptId);
    setReceipt(null);
    setReceiptError(null);
    try {
      setReceipt(await loadReceipt(attemptId));
    } catch (failure) {
      setReceiptError(
        failure instanceof ApiError ? failure.message : 'The receipt did not load. Try again.',
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setData(await loadDesk());
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  /** Applies the state a change leaves behind: what waits, what went wrong, the session, and whether to reload. */
  const settle = useCallback(
    (settled: Settled, previous: SessionInfo) => {
      setPending(settled.pending);
      setError(settled.error);
      if (settled.session !== previous) {
        onSession(settled.session);
      }
      if (settled.refresh) {
        void refresh();
      }
    },
    [onSession, refresh],
  );

  const run = useCallback(
    async (action: PendingAction, current: SessionInfo) => {
      setBusy(true);
      const settled = await performAction(action, current, PORTS);
      setBusy(false);
      settle(settled, current);
    },
    [settle],
  );

  const onTogglePause = useCallback(() => {
    if (data !== null) {
      void run({ kind: 'pause', paused: !data.overview.paused }, session);
    }
  }, [data, run, session]);

  const onRequestLimits = useCallback(
    (values: LimitValues) => {
      void run({ kind: 'limits', values }, session);
    },
    [run, session],
  );

  const onApprove = useCallback(
    (requestId: string) => {
      void run({ kind: 'approve', requestId }, session);
    },
    [run, session],
  );

  const onConfirm = useCallback(
    async (password: string) => {
      setBusy(true);
      const settled = await confirmAndPerform(password, session, pending, PORTS);
      setBusy(false);
      settle(settled, session);
    },
    [pending, session, settle],
  );

  if (receiptId !== null) {
    return (
      <ReceiptView
        receipt={receipt}
        error={receiptError}
        onBack={() => {
          setReceiptId(null);
          setReceipt(null);
          setReceiptError(null);
        }}
      />
    );
  }

  if (openId !== null) {
    return (
      <InvoiceView
        detail={detail}
        error={detailError}
        onBack={() => {
          setOpenId(null);
          setDetail(null);
          setDetailError(null);
        }}
      />
    );
  }

  return (
    <DeskView
      data={data}
      error={error}
      busy={busy}
      pending={pending}
      onTogglePause={onTogglePause}
      onRequestLimits={onRequestLimits}
      onApprove={onApprove}
      onConfirm={onConfirm}
      onCancelConfirm={() => {
        setPending(null);
      }}
      onOpen={(rowId) => {
        void openInvoice(rowId);
      }}
      onReceipt={(attemptId) => {
        void openReceipt(attemptId);
      }}
      onSendTestInvoice={async (zarMinor) => {
        const sent = await sendTestInvoice(zarMinor, session.csrfToken);
        void refresh();
        return `Invoice ${sent.invoiceNumber} is in the agent's inbox (USD ${(sent.usdMinor / 100).toFixed(2)}). Open the Agent map to watch it.`;
      }}
    />
  );
}
