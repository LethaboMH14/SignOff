import { ImapFlow } from 'imapflow';

import type { MailboxPort } from './watch.js';

export interface ImapSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  /** An app password for the mailbox, read from the environment and never printed. */
  readonly password: string;
}

/** How long a polite LOGOUT may take before the connection is simply closed. */
export const LOGOUT_LIMIT_MS = 3000;

/** True when the server refused the credentials, as opposed to a network failure or a timeout. */
export function isAuthFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { authenticationFailed?: unknown }).authenticationFailed === true
  );
}

/** A connection that sends nothing for this long is closed by the library, so a stalled server is noticed. */
export const SOCKET_TIMEOUT_MS = 60_000;

/** The mailbox over IMAP with TLS. Every call takes the INBOX lock for its own duration. */
export async function connectImap(settings: ImapSettings): Promise<{
  readonly port: MailboxPort;
  readonly close: () => Promise<void>;
  /** False once the library or the server has closed the connection. */
  readonly usable: () => boolean;
}> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: true,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  // A dropped connection (for example ECONNRESET from the server) is emitted as an 'error' event. Without a listener
  // Node ends the process, and the launcher then stops the whole demo (seen on 13 Nov). The operation in progress
  // fails, and the connection is no longer usable, so the keeper opens a new one.
  client.on('error', (error: unknown) => {
    const code = (error as { code?: unknown }).code;
    process.stderr.write(`mail connection error: ${typeof code === 'string' ? code : 'unknown'}\n`);
  });
  await client.connect();

  const withInbox = async <T>(work: () => Promise<T>): Promise<T> => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      return await work();
    } finally {
      lock.release();
    }
  };

  const port: MailboxPort = {
    nextUid: () =>
      withInbox(() => Promise.resolve(client.mailbox === false ? 1 : client.mailbox.uidNext)),
    unreadFrom: (fromUid) =>
      withInbox(async () => {
        const found = await client.search({ seen: false }, { uid: true });
        return (Array.isArray(found) ? found : [])
          .filter((uid) => uid >= fromUid)
          .sort((a, b) => a - b);
      }),
    source: (uid) =>
      withInbox(async () => {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        return message === false ? null : (message.source ?? null);
      }),
    markRead: (uid) =>
      withInbox(async () => {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }),
  };

  return {
    port,
    usable: () => client.usable,
    // LOGOUT waits for the server. On a stalled connection it would never answer, so it gets a few seconds, and then
    // the socket is closed regardless (the hang this watcher was rebuilt to avoid).
    close: async () => {
      const loggedOut = await Promise.race([
        client.logout().then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((done) => {
          setTimeout(() => {
            done(false);
          }, LOGOUT_LIMIT_MS).unref();
        }),
      ]);
      if (!loggedOut) {
        client.close();
      }
    },
  };
}
