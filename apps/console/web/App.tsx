import { useEffect, useState } from 'react';

import { currentSession, type SessionInfo, signOut } from './api.js';
import { Desk } from './Desk.js';
import './desk.css';
import { Login } from './Login.js';
import { MapView } from './MapView.js';

type View = 'desk' | 'map';

/**
 * The console's shell. It asks the server who is signed in; with nobody signed in it shows the sign-in form and nothing
 * else. Signing out ends the session on the server and forgets the form token here.
 */
export function App() {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [view, setView] = useState<View>('desk');
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    currentSession().then(setSession, () => {
      setUnreachable(true);
      setSession(null);
    });
  }, []);

  if (session === undefined) {
    return (
      <p role="status" className="loading">
        Checking your sign-in…
      </p>
    );
  }
  if (session === null) {
    return (
      <>
        {unreachable ? (
          <p role="alert" className="notice">
            The console is not answering. Check that it is running.
          </p>
        ) : null}
        <Login onSignedIn={setSession} />
      </>
    );
  }

  const endSession = async (): Promise<void> => {
    try {
      await signOut(session.csrfToken);
    } finally {
      setSession(null);
    }
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">SignOff · operator console</p>
          <h1>{view === 'desk' ? 'Payment desk' : 'The agents at work'}</h1>
        </div>
        <nav className="views" aria-label="Views">
          <button
            type="button"
            aria-pressed={view === 'desk'}
            onClick={() => {
              setView('desk');
            }}
          >
            Payment desk
          </button>
          <button
            type="button"
            aria-pressed={view === 'map'}
            onClick={() => {
              setView('map');
            }}
          >
            Agent map
          </button>
        </nav>
        <p className="who">
          Signed in as {session.username}{' '}
          <button
            type="button"
            onClick={() => {
              void endSession();
            }}
          >
            Sign out
          </button>
        </p>
      </header>
      <main>
        {view === 'desk' ? <Desk session={session} onSession={setSession} /> : <MapView />}
      </main>
    </>
  );
}
