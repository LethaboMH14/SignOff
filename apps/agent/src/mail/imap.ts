import { ImapFlow } from 'imapflow';

import type { MailboxPort } from './watch.js';

export interface ImapSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  /** An app password for the mailbox, read from the environment and never printed. */
  readonly password: string;
}

/** The mailbox over IMAP with TLS. Every call takes the INBOX lock for its own duration. */
export async function connectImap(settings: ImapSettings): Promise<{
  readonly port: MailboxPort;
  readonly close: () => Promise<void>;
}> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: true,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
  });
  // A dropped connection (for example ECONNRESET from the server) is emitted as an 'error' event. Without a listener
  // Node ends the process, and the launcher then stops the whole demo (seen on 13 Nov). The operation in progress
  // fails or times out instead, and the watcher's next check opens a fresh connection.
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
    close: async () => {
      await client.logout().catch(() => {
        client.close();
      });
    },
  };
}
