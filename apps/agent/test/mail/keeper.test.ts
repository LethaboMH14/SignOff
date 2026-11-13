import { describe, expect, it } from 'vitest';

import { createMailboxKeeper, type KeptMailbox } from '../../src/mail/keeper.js';
import type { MailboxPort } from '../../src/mail/watch.js';

const PORT: MailboxPort = {
  nextUid: () => Promise.resolve(1),
  unreadFrom: () => Promise.resolve([]),
  source: () => Promise.resolve(null),
  markRead: () => Promise.resolve(),
};

/** A stand-in connection that records whether it was closed. */
class FakeConnection implements KeptMailbox {
  readonly port = PORT;
  closed = 0;
  live = true;
  usable(): boolean {
    return this.live;
  }
  close(): Promise<void> {
    this.closed += 1;
    this.live = false;
    return Promise.resolve();
  }
}

function fakeOpener(): { opened: FakeConnection[]; open: () => Promise<KeptMailbox> } {
  const opened: FakeConnection[] = [];
  return {
    opened,
    open: () => {
      const connection = new FakeConnection();
      opened.push(connection);
      return Promise.resolve(connection);
    },
  };
}

const wait = (ms: number): Promise<void> =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });

describe('the kept mailbox connection', () => {
  it('reuses one connection across checks instead of signing in each time', async () => {
    const { opened, open } = fakeOpener();
    const keeper = createMailboxKeeper(open, 1000);
    for (let index = 0; index < 3; index += 1) {
      await keeper.check(() => Promise.resolve(index));
    }
    expect(opened).toHaveLength(1);
    expect(opened[0]?.closed).toBe(0);
  });

  it('opens a new connection once the kept one is no longer usable', async () => {
    const { opened, open } = fakeOpener();
    const keeper = createMailboxKeeper(open, 1000);
    await keeper.check(() => Promise.resolve(1));
    const first = opened[0];
    if (first !== undefined) {
      first.live = false;
    }
    await keeper.check(() => Promise.resolve(2));
    expect(opened).toHaveLength(2);
    expect(first?.closed).toBe(1);
  });

  it('closes a connection whose check stalls, and opens a new one once the stalled work ends', async () => {
    const { opened, open } = fakeOpener();
    const keeper = createMailboxKeeper(open, 20);
    let release: () => void = () => undefined;
    const stuck = new Promise<void>((done) => {
      release = done;
    });
    await expect(keeper.check(() => stuck)).rejects.toThrow('did not answer');
    expect(opened[0]?.closed).toBe(1);
    release();
    await wait(5);
    await keeper.check(() => Promise.resolve('ok'));
    expect(opened).toHaveLength(2);
  });

  it('keeps the connection after an ordinary error, because a failed command does not break it', async () => {
    const { opened, open } = fakeOpener();
    const keeper = createMailboxKeeper(open, 1000);
    await expect(keeper.check(() => Promise.reject(new Error('NO message')))).rejects.toThrow(
      'NO message',
    );
    await keeper.check(() => Promise.resolve('ok'));
    expect(opened).toHaveLength(1);
    expect(opened[0]?.closed).toBe(0);
  });

  it('never starts a check while an abandoned check is still running, so one message is not handled twice', async () => {
    const { open } = fakeOpener();
    const keeper = createMailboxKeeper(open, 20);
    const events: string[] = [];
    await expect(
      keeper.check(async () => {
        await wait(80);
        events.push('abandoned check ends');
      }),
    ).rejects.toThrow('did not answer');
    await expect(
      keeper.check(() => {
        events.push('skipped check');
        return Promise.resolve();
      }),
    ).rejects.toThrow('still running');
    await wait(120);
    await keeper.check(() => {
      events.push('next check');
      return Promise.resolve();
    });
    expect(events).toEqual(['abandoned check ends', 'next check']);
  });

  it('closes a connection that finishes opening after its time limit, so it is not left logged in', async () => {
    const late = new FakeConnection();
    const keeper = createMailboxKeeper(() => wait(40).then(() => late), 10);
    await expect(keeper.check(() => Promise.resolve(1))).rejects.toThrow('did not answer');
    await wait(60);
    expect(late.closed).toBe(1);
  });

  it('closes the kept connection when the watcher stops', async () => {
    const { opened, open } = fakeOpener();
    const keeper = createMailboxKeeper(open, 1000);
    await keeper.check(() => Promise.resolve(1));
    await keeper.close();
    expect(opened[0]?.closed).toBe(1);
  });
});
