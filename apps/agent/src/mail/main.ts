import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { connectImap } from './imap.js';
import { sendersOf } from './admit.js';
import { pollOnce, type WatchOptions } from './watch.js';

/**
 * The mailbox watcher, a process of its own. It holds the mailbox password and nothing else: no ledger key, no Warden
 * secret, no model key. It only copies accepted PDFs into the agent's inbox.
 *
 *   tsx apps/agent/src/mail/main.ts --inbox <dir> --log <file>
 *
 * Settings come from the environment: SIGNOFF_MAIL_USER, SIGNOFF_MAIL_PASSWORD (an app password),
 * SIGNOFF_MAIL_ALLOWED_SENDERS (comma-separated), and optionally SIGNOFF_MAIL_HOST (imap.gmail.com), SIGNOFF_MAIL_PORT
 * (993) and SIGNOFF_MAIL_AUTHSERV (mx.google.com).
 */

const POLL_MS = 4000;

function need(name: string): string {
  // eslint-disable-next-line security/detect-object-injection -- the names are the fixed SIGNOFF_MAIL_ settings below
  const value = process.env[name]?.trim() ?? '';
  if (value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
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
  const settings = {
    host: process.env['SIGNOFF_MAIL_HOST']?.trim() ?? 'imap.gmail.com',
    port,
    user: need('SIGNOFF_MAIL_USER'),
    password: need('SIGNOFF_MAIL_PASSWORD'),
  };
  let mailbox = await connectImap(settings);
  let fromUid = await mailbox.port.nextUid();
  process.stdout.write(
    `mail watcher running: ${String(options.policy.allowedSenders.size)} allowed sender(s); only email that arrives from now on is read\n`,
  );

  const state = { stopped: false };
  const stop = (): void => {
    state.stopped = true;
    void mailbox.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!state.stopped) {
    try {
      fromUid = await pollOnce(mailbox.port, fromUid, options);
    } catch (error) {
      // A failed poll changes nothing on disk; the next poll tries again. The message is short and holds no secret.
      process.stderr.write(
        `mail poll failed: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}; reconnecting\n`,
      );
      await mailbox.close();
      const previous = mailbox;
      mailbox = await connectImap(settings).catch(() => previous);
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
