import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  type DeskData,
  confirmPassword,
  loadDesk,
  type SessionInfo,
  setPaused,
} from './api.js';
import { DeskView } from './DeskView.js';

/** How often the desk asks the console for fresh rows. A change also refreshes at once. */
const REFRESH_MS = 5000;

function messageOf(failure: unknown): string {
  return failure instanceof ApiError ? failure.message : 'The desk did not load. Try again.';
}

export interface DeskProps {
  readonly session: SessionInfo;
  readonly onSession: (session: SessionInfo) => void;
}

/** The desk with its state: it reads the console API, and asks for the password again before a pause or resume. */
export function Desk({ session, onSession }: DeskProps) {
  const [data, setData] = useState<DeskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The pause (true) or resume (false) waiting for the password, or null when nothing is waiting. */
  const [wanted, setWanted] = useState<boolean | null>(null);

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

  const applyPause = useCallback(
    async (paused: boolean, current: SessionInfo) => {
      setBusy(true);
      try {
        await setPaused(paused, current.csrfToken);
        setWanted(null);
        await refresh();
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'STEP_UP_REQUIRED') {
          setWanted(paused);
        } else {
          setError(messageOf(failure));
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onTogglePause = useCallback(() => {
    if (data !== null) {
      void applyPause(!data.overview.paused, session);
    }
  }, [applyPause, data, session]);

  const onConfirm = useCallback(
    async (password: string) => {
      setBusy(true);
      try {
        await confirmPassword(password, session.csrfToken);
        const fresh: SessionInfo = { ...session, stepUp: true };
        onSession(fresh);
        if (wanted !== null) {
          await applyPause(wanted, fresh);
        }
      } catch (failure) {
        setError(messageOf(failure));
      } finally {
        setBusy(false);
      }
    },
    [applyPause, onSession, session, wanted],
  );

  return (
    <DeskView
      data={data}
      error={error}
      busy={busy}
      waitingFor={wanted}
      onTogglePause={onTogglePause}
      onConfirm={onConfirm}
      onCancelConfirm={() => {
        setWanted(null);
      }}
    />
  );
}
