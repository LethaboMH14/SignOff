import { useEffect, useState } from 'react';

import { currentSession, type SessionInfo, signOut } from './api.js';
import { Intro } from './Intro.js';
import { Login } from './Login.js';
import './desk.css';
import './views.css';
import './studio.css';
import { Studio } from './Studio.js';

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

  return (
    <Studio
      session={session}
      onSession={setSession}
      onSignOut={() => {
        void endSession();
      }}
    />
  );
}
