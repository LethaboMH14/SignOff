import { type SubmitEvent, useState } from 'react';

import { ApiError, type SessionInfo, signIn } from './api.js';
import { AgentFlow, Brand } from './Brand.js';

/** The sign-in form. The message for a refusal is the same whether the name or the password was wrong. */
export function Login({ onSignedIn }: { readonly onSignedIn: (session: SessionInfo) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSignedIn(await signIn(username, password));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Sign-in did not work. Try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin-page">
      <section className="signin-brand" aria-label="About SignOff">
        <Brand className="brand-large" />
        <AgentFlow className="signin-flow" />
        <p className="lede-large">
          An AI accounts-payable agent that cannot move money alone. Every payment needs two
          signatures: the agent&rsquo;s, and Warden&rsquo;s.
        </p>
      </section>
      <section className="signin-card" aria-labelledby="signin-title">
        <p className="eyebrow">SignOff · operator console</p>
        <h1 id="signin-title">Sign in</h1>
        <p className="lede">
          Changes to payments, limits and the pause need your password again a few minutes after you
          sign in.
        </p>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
            />
          </label>
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
          {message === null ? null : (
            <p role="alert" className="notice">
              {message}
            </p>
          )}
          <button type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
