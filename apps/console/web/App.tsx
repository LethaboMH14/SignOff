import { useEffect, useState } from 'react';

import { currentSession, type SessionInfo, signOut } from './api.js';
import { Brand } from './Brand.js';
import { Desk } from './Desk.js';
import { Intro } from './Intro.js';
import { Login } from './Login.js';
import { MapView } from './MapView.js';
import './desk.css';
import './views.css';

type View = 'desk' | 'map';

/** The order of the views. Moving to a later view slides the screen in from the right; moving back, from the left. */
function orderOf(view: View): number {
  switch (view) {
    case 'desk':
      return 0;
    case 'map':
      return 1;
  }
}

function titleOf(view: View): string {
  switch (view) {
    case 'desk':
      return 'Payment desk';
    case 'map':
      return 'The agents at work';
  }
}

/** Two letters of a username, for the round avatar. */
export function initialsOf(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

/** The role in words. A role is never shown by colour alone. */
export function roleWordOf(role: SessionInfo['role']): string {
  return role === 'operator' ? 'Operator' : 'Viewer';
}

/**
 * The console's shell. It asks the server who is signed in; with nobody signed in it shows the sign-in form and nothing
 * else. Signing out ends the session on the server and forgets the form token here. The opening plays once per page load.
 */
export function App() {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [view, setView] = useState<View>('desk');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    currentSession().then(setSession, () => {
      setUnreachable(true);
      setSession(null);
    });
  }, []);

  if (session === undefined) {
    return (
      <>
        <Intro />
        <p role="status" className="loading">
          Checking your sign-in…
        </p>
      </>
    );
  }
  if (session === null) {
    return (
      <>
        <Intro />
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

  const choose = (next: View): void => {
    setDirection(orderOf(next) >= orderOf(view) ? 'forward' : 'back');
    setView(next);
  };

  return (
    <>
      <Intro />
      <div className="shell">
        <header className="site-head">
          <Brand />
          <nav className="views" aria-label="Views">
            <button
              type="button"
              aria-pressed={view === 'desk'}
              onClick={() => {
                choose('desk');
              }}
            >
              Payment desk
            </button>
            <button
              type="button"
              aria-pressed={view === 'map'}
              onClick={() => {
                choose('map');
              }}
            >
              Agent map
            </button>
          </nav>
          <p className="who">
            <span className="avatar" aria-hidden="true">
              {initialsOf(session.username)}
            </span>
            <span className="who-text">
              <span className="visually-hidden">Signed in as </span>
              <strong>{session.username}</strong>
              <span className="who-role">{roleWordOf(session.role)}</span>
            </span>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                void endSession();
              }}
            >
              Sign out
            </button>
          </p>
        </header>
        <main>
          <h1 className="page-title">{titleOf(view)}</h1>
          <div key={view} className={`view view-${direction}`}>
            {view === 'desk' ? <Desk session={session} onSession={setSession} /> : <MapView />}
          </div>
        </main>
      </div>
    </>
  );
}
