import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { connectImap, type ImapSettings } from './imap.js';
import { sendersOf } from './admit.js';
import { type MailboxPort, pollOnce, type WatchOptions, withTimeout } from './watch.js';

/**
 * The mailbox watcher, a process of its own. It holds the mailbox password and nothing else: no ledger key, no Warden
 * secret, no model key. It only copies accepted PDFs into the agent's inbox.
 *
 *   tsx apps/agent/src/mail/main.ts --inbox <dir> --log <file>
 *
 * Each check opens its own connection, does its work and closes it. A long-lived connection stopped answering during
 * testing with no error, so the watcher now starts clean every time.
 *
 * Settings come from the environment: SIGNOFF_MAIL_USER, SIGNOFF_MAIL_PASSWORD (an app password),
 * SIGNOFF_MAIL_ALLOWED_SENDERS (comma-separated), and optionally SIGNOFF_MAIL_HOST (imap.gmail.com), SIGNOFF_MAIL_PORT
 * (993) and SIGNOFF_MAIL_AUTHSERV (mx.google.com).
 */

const POLL_MS = 5000;
/** The longest one check may take before it is abandoned. */
const CHECK_TIMEOUT_MS = 30_000;

function need(name: string): string {
  // eslint-disable-next-line security/detect-object-injection -- the names are the fixed SIGNOFF_MAIL_ settings below
  const value = process.env[name]?.trim() ?? '';
  if (value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** Runs one piece of work on a fresh connection, then closes the connection, whatever happened. */
async function onFreshConnection<T>(
  settings: ImapSettings,
  work: (port: MailboxPort) => Promise<T>,
): Promise<T> {
  const mailbox = await connectImap(settings);
  try {
    return await withTimeout(work(mailbox.port), CHECK_TIMEOUT_MS);
  } finally {
    await mailbox.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { inbox: { type: 'string' }, log: { type: 'string' } },
  });
  if (values.inbox === undefined || values.log === undefined) {
    throw new Error('--inbox and --log are required');
  }
  const port = Number(process.env['SIGNOFF_MAIL_PORT'] ?? '993');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SIGNOFF_MAIL_PORT must be a port number');
  }
  const options: WatchOptions = {
    policy: {
      allowedSenders: sendersOf(need('SIGNOFF_MAIL_ALLOWED_SENDERS')),
      authservId: process.env['SIGNOFF_MAIL_AUTHSERV']?.trim() ?? 'mx.google.com',
    },
    inboxDir: resolve(values.inbox),
    logPath: resolve(values.log),
  };
  const settings: ImapSettings = {
    host: process.env['SIGNOFF_MAIL_HOST']?.trim() ?? 'imap.gmail.com',
    port,
    user: need('SIGNOFF_MAIL_USER'),
    password: need('SIGNOFF_MAIL_PASSWORD'),
  };

  // The first connection proves the sign-in works and sets the starting point. Mail that arrives after this is read.
  let fromUid = await onFreshConnection(settings, (mailbox) => mailbox.nextUid()).catch(
    (error: unknown) => {
      // The server's reason says why it refused (for example "Invalid credentials"). The password is never printed.
      const reason = error instanceof Error ? error.message : 'unknown';
      const detail = (error as { responseText?: unknown }).responseText;
      const why = typeof detail === 'string' && detail !== '' ? detail : reason;
      throw new Error(
        `the mail server refused the sign-in (${why}). SIGNOFF_MAIL_PASSWORD must be the 16-letter Google app password for SIGNOFF_MAIL_USER, not the normal password. Nothing was started.`,
      );
    },
  );
  process.stdout.write(
    `mail watcher running: ${String(options.policy.allowedSenders.size)} allowed sender(s); only email that arrives from now on is read\n`,
  );

  const state = { stopped: false };
  process.on('SIGINT', () => {
    state.stopped = true;
  });
  process.on('SIGTERM', () => {
    state.stopped = true;
  });

  while (!state.stopped) {
    try {
      fromUid = await onFreshConnection(settings, (mailbox) => pollOnce(mailbox, fromUid, options));
    } catch (error) {
      // A failed check changes nothing on disk; the next check tries again. The message is short and holds no secret.
      process.stderr.write(
        `mail check failed: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}; trying again\n`,
      );
    }
    await new Promise((done) => {
      setTimeout(done, POLL_MS);
    });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'unknown failure'}\n`);
  process.exitCode = 1;
});
