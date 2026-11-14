import { type SubmitEvent, useState } from 'react';

import { ApiError, type SessionInfo, signIn } from './api.js';
import { AgentFlow, Brand } from './Brand.js';

/**
 * The judge's demo login, shown on the sign-in page only when the public build is given it at build time
 * (VITE_DEMO_LOGIN_USER and VITE_DEMO_LOGIN_PASSWORD). The source holds no password, so nothing secret enters git.
 */
const DEMO_LOGIN: { readonly username: string; readonly password: string } | null = (() => {
  const username: unknown = import.meta.env['VITE_DEMO_LOGIN_USER'];
  const password: unknown = import.meta.env['VITE_DEMO_LOGIN_PASSWORD'];
  return typeof username === 'string' &&
    username !== '' &&
    typeof password === 'string' &&
    password !== ''
    ? { username, password }
    : null;
})();

/** The judges' operator login, shown the same way when the build is given VITE_DEMO_OPERATOR_USER and VITE_DEMO_OPERATOR_PASSWORD. */
const DEMO_OPERATOR: { readonly username: string; readonly password: string } | null = (() => {
  const username: unknown = import.meta.env['VITE_DEMO_OPERATOR_USER'];
  const password: unknown = import.meta.env['VITE_DEMO_OPERATOR_PASSWORD'];
  return typeof username === 'string' &&
    username !== '' &&
    typeof password === 'string' &&
    password !== ''
    ? { username, password }
    : null;
})();

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
    <main className="signin-page so-app so-login">
      <section className="signin-brand so-login-brand" aria-label="About SignOff">
        <Brand className="brand-large" />
        <AgentFlow className="signin-flow" />
        <p className="lede-large">
          An AI accounts-payable agent that cannot move money alone. Every payment needs two
          signatures: the agent&rsquo;s, and Warden&rsquo;s.
        </p>
      </section>
      <section className="signin-card so-login-card" aria-labelledby="signin-title">
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
        {DEMO_LOGIN === null ? null : (
          <p className="lede" role="note">
            Judges: demo viewer login. It is read-only, replays a fictional run and holds no real
            data. Username <b>{DEMO_LOGIN.username}</b>, password <b>{DEMO_LOGIN.password}</b>.
          </p>
        )}
        {DEMO_OPERATOR === null ? null : (
          <p className="lede" role="note">
            Judges, operator login: username <b>{DEMO_OPERATOR.username}</b>, password{' '}
            <b>{DEMO_OPERATOR.password}</b>. No Warden is connected to this simulated console, so
            the payment desk and the Warden pages say that this account has no Warden access. To
            test pause, limits and approvals, run the console locally.
          </p>
        )}
      </section>
    </main>
  );
}
