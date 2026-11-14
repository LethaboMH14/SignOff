import { type MailboxPort, StallError, withTimeout } from './watch.js';

/** A connection the watcher keeps between checks: its mailbox calls, whether it is still open, and how to close it. */
export interface KeptMailbox {
  readonly port: MailboxPort;
  usable(): boolean;
  close(): Promise<void>;
}

export interface MailboxKeeper {
  /** Runs one check on the kept connection, opening a connection first if none is kept that still works. */
  check<T>(work: (port: MailboxPort) => Promise<T>): Promise<T>;
  /** Closes the kept connection, if there is one. */
  close(): Promise<void>;
}

/**
 * Keeps one connection open across checks. Each sign-in is counted by Gmail, which may throttle frequent ones, so the
 * connection is reused until the server closes it or a check stalls. A stalled connection is closed and replaced. No
 * new check starts while an abandoned check is still running, so one message is never handled twice at once.
 */
export function createMailboxKeeper(
  open: () => Promise<KeptMailbox>,
  limitMs: number,
): MailboxKeeper {
  let kept: KeptMailbox | null = null;
  let unfinished: Promise<void> | null = null;

  async function drop(): Promise<void> {
    const old = kept;
    kept = null;
    await old?.close();
  }

  async function openNow(): Promise<KeptMailbox> {
    const opening = open();
    try {
      const opened = await withTimeout(opening, limitMs);
      kept = opened;
      return opened;
    } catch (error) {
      // A connection that finishes opening after its time limit is closed, so it is not left logged in.
      void opening.then(
        (late) => late.close(),
        () => undefined,
      );
      throw error;
    }
  }

  return {
    async check<T>(work: (port: MailboxPort) => Promise<T>): Promise<T> {
      if (unfinished !== null) {
        throw new Error('an earlier check is still running, so this one is skipped');
      }
      let mailbox = kept;
      if (!mailbox?.usable()) {
        await drop();
        mailbox = await openNow();
      }
      const running = work(mailbox.port);
      const done = running.then(
        () => undefined,
        () => undefined,
      );
      try {
        return await withTimeout(running, limitMs);
      } catch (error) {
        // Only a stall makes the connection suspect. An ordinary error leaves a working connection in place.
        if (error instanceof StallError && kept === mailbox) {
          kept = null;
          await mailbox.close();
        }
        throw error;
      } finally {
        const finished = await withTimeout(done, limitMs).then(
          () => true,
          () => false,
        );
        if (!finished) {
          unfinished = done.then(() => {
            unfinished = null;
          });
        }
      }
    },
    close: drop,
  };
}
