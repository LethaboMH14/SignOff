import type { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the IMAP library: it records the calls the adapter makes and answers from a small mailbox. */
const calls: string[] = [];
const state: { search: number[] | false; released: number } = { search: [7, 3, 12], released: 0 };

const clients: EventEmitter[] = [];

vi.mock('imapflow', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    ImapFlow: class extends Emitter {
      mailbox: { uidNext: number } | false = { uidNext: 10 };
      constructor(options: { secure: boolean; logger: unknown }) {
        super();
        calls.push(`new secure=${String(options.secure)} logger=${String(options.logger)}`);
        clients.push(this);
      }
      close(): void {
        calls.push('close');
      }
      connect(): Promise<void> {
        calls.push('connect');
        return Promise.resolve();
      }
      getMailboxLock(path: string): Promise<{ path: string; release: () => void }> {
        calls.push(`lock ${path}`);
        return Promise.resolve({
          path,
          release: () => {
            state.released += 1;
          },
        });
      }
      search(query: { seen: boolean }, options: { uid: boolean }): Promise<number[] | false> {
        calls.push(`search seen=${String(query.seen)} uid=${String(options.uid)}`);
        return Promise.resolve(state.search);
      }
      fetchOne(
        range: string,
        query: { source: boolean },
        options: { uid: boolean },
      ): Promise<{ source: Buffer } | false> {
        calls.push(`fetch ${range} source=${String(query.source)} uid=${String(options.uid)}`);
        return Promise.resolve(range === '404' ? false : { source: Buffer.from('raw message') });
      }
      messageFlagsAdd(range: string, flags: string[], options: { uid: boolean }): Promise<boolean> {
        calls.push(`flag ${range} ${flags.join(',')} uid=${String(options.uid)}`);
        return Promise.resolve(true);
      }
      logout(): Promise<void> {
        calls.push('logout');
        return Promise.reject(new Error('already closed'));
      }
    },
  };
});

const { connectImap } = await import('../../src/mail/imap.js');

const SETTINGS = { host: 'imap.example', port: 993, user: 'u@example.com', password: 'p' };

beforeEach(() => {
  calls.length = 0;
  state.search = [7, 3, 12];
  state.released = 0;
});

describe('the IMAP adapter', () => {
  it('connects over TLS without the library logger, which could print mailbox details', async () => {
    await connectImap(SETTINGS);
    expect(calls.slice(0, 2)).toEqual(['new secure=true logger=false', 'connect']);
  });

  it('reads the next UID, unread UIDs from a point in order, a source, and marks a message read', async () => {
    const { port } = await connectImap(SETTINGS);
    expect(await port.nextUid()).toBe(10);
    expect(await port.unreadFrom(5)).toEqual([7, 12]);
    expect((await port.source(7))?.toString()).toBe('raw message');
    expect(await port.source(404)).toBeNull();
    await port.markRead(7);
    expect(calls).toContain('flag 7 \\Seen uid=true');
    expect(calls.filter((call) => call === 'lock INBOX')).toHaveLength(5);
    expect(state.released).toBe(5);
  });

  it('treats a failed search as no unread mail', async () => {
    state.search = false;
    const { port } = await connectImap(SETTINGS);
    expect(await port.unreadFrom(1)).toEqual([]);
  });

  it('closes quietly even when the server already dropped the connection', async () => {
    const { close } = await connectImap(SETTINGS);
    await expect(close()).resolves.toBeUndefined();
    expect(calls).toContain('logout');
    expect(calls).toContain('close');
  });

  it('survives a connection reset from the server instead of ending the process', async () => {
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await connectImap(SETTINGS);
    const client = clients.at(-1);
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    // An EventEmitter with no 'error' listener throws here; that throw is what ended the watcher on 13 Nov.
    expect(() => client?.emit('error', reset)).not.toThrow();
    expect(written).toHaveBeenCalledWith('mail connection error: ECONNRESET\n');
    written.mockRestore();
  });
});
