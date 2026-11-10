import { type SubmitEvent, useState } from 'react';

import { ApiError, type SessionInfo, signIn } from './api.js';

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
    <main className="signin">
      <p className="eyebrow">SignOff · operator console</p>
      <h1>Sign in</h1>
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
    </main>
  );
}
