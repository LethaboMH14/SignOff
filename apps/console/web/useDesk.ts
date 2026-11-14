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
  type TestInvoiceChoice,
  type TestInvoiceResult,
} from './api.js';
import { type ActionPorts, confirmAndPerform, performAction, type Settled } from './actions.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';
import type { ReceiptView as ReceiptData } from '../src/server/receipt.js';

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

export interface DeskState {
  readonly data: DeskData | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly pending: PendingAction | null;
  readonly openId: string | null;
  readonly detail: InvoiceDetail | null;
  readonly detailError: string | null;
  readonly receiptId: string | null;
  readonly receipt: ReceiptData | null;
  readonly receiptError: string | null;
  readonly openInvoice: (rowId: string) => void;
  readonly closeInvoice: () => void;
  readonly openReceipt: (attemptId: string) => void;
  readonly closeReceipt: () => void;
  readonly onTogglePause: () => void;
  readonly onRequestLimits: (values: LimitValues) => void;
  readonly onApprove: (requestId: string) => void;
  readonly onConfirm: (password: string) => Promise<void>;
  readonly onCancelConfirm: () => void;
  readonly onSendTestInvoice: (choice: TestInvoiceChoice) => Promise<TestInvoiceResult>;
}

/**
 * The desk's data and the operator's changes, shared by every page of the console. It reads the console API every few
 * seconds. A pause, a limit change or an approval that the console refuses for want of a recent password waits; the
 * password is asked for; the same change is then sent again. Nothing here decides a payment state.
 */
export function useDesk(
  session: SessionInfo,
  onSession: (session: SessionInfo) => void,
): DeskState {
  const [data, setData] = useState<DeskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const openInvoice = useCallback((rowId: string) => {
    setOpenId(rowId);
    setDetail(null);
    setDetailError(null);
    loadInvoice(rowId).then(setDetail, (failure: unknown) => {
      setDetailError(
        failure instanceof ApiError ? failure.message : 'The invoice did not load. Try again.',
      );
    });
  }, []);

  const closeInvoice = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const openReceipt = useCallback((attemptId: string) => {
    setReceiptId(attemptId);
    setReceipt(null);
    setReceiptError(null);
    loadReceipt(attemptId).then(setReceipt, (failure: unknown) => {
      setReceiptError(
        failure instanceof ApiError ? failure.message : 'The receipt did not load. Try again.',
      );
    });
  }, []);

  const closeReceipt = useCallback(() => {
    setReceiptId(null);
    setReceipt(null);
    setReceiptError(null);
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

  const onCancelConfirm = useCallback(() => {
    setPending(null);
  }, []);

  const onSendTestInvoice = useCallback(
    async (choice: TestInvoiceChoice) => {
      const sent = await sendTestInvoice(choice, session.csrfToken);
      void refresh();
      return sent;
    },
    [refresh, session.csrfToken],
  );

  return {
    data,
    error,
    busy,
    pending,
    openId,
    detail,
    detailError,
    receiptId,
    receipt,
    receiptError,
    openInvoice,
    closeInvoice,
    openReceipt,
    closeReceipt,
    onTogglePause,
    onRequestLimits,
    onApprove,
    onConfirm,
    onCancelConfirm,
    onSendTestInvoice,
  };
}
