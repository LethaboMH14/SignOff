/* eslint-disable security/detect-non-literal-fs-filename -- each test writes only inside its own temporary folder */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import {
  addressOf,
  decideMail,
  dmarcPassed,
  type MailPolicy,
  type ParsedMail,
  sendersOf,
} from '../../src/mail/admit.js';
import {
  handleMessage,
  type MailboxPort,
  parseMessage,
  pollOnce,
  type WatchOptions,
} from '../../src/mail/watch.js';

const SUPPLIER = 'accounts@supplier.example';
const POLICY: MailPolicy = { allowedSenders: new Set([SUPPLIER]), authservId: 'mx.google.com' };
const PASS =
  'mx.google.com; dkim=pass header.i=@supplier.example; spf=pass; dmarc=pass (p=NONE) header.from=supplier.example';
const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n% a tiny fictional invoice\n%%EOF\n', 'latin1'));

function mailOf(overrides: Partial<ParsedMail> = {}): ParsedMail {
  return {
    uid: 7,
    from: SUPPLIER,
    authenticationResults: [PASS],
    attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF }],
    bodyText: 'Please find our invoice attached.',
    ...overrides,
  };
}

describe('who may send an invoice', () => {
  it('reads the bare address from a From value', () => {
    expect(addressOf('Thandi <Accounts@Supplier.Example>')).toBe(SUPPLIER);
    expect(addressOf(SUPPLIER)).toBe(SUPPLIER);
    expect(addressOf('not an address')).toBeNull();
    expect(addressOf(null)).toBeNull();
  });

  it('trusts only the topmost Authentication-Results from our own server', () => {
    expect(dmarcPassed([PASS], 'mx.google.com')).toBe(true);
    expect(
      dmarcPassed(['mx.google.com; dmarc=fail header.from=supplier.example'], 'mx.google.com'),
    ).toBe(false);
    // A sender can write a passing header lower down; our server's own verdict is above it and wins.
    expect(
      dmarcPassed(['mx.google.com; dmarc=fail', 'mx.google.com; dmarc=pass'], 'mx.google.com'),
    ).toBe(false);
    expect(dmarcPassed(['evil.example; dmarc=pass'], 'mx.google.com')).toBe(false);
    expect(dmarcPassed([], 'mx.google.com')).toBe(false);
  });

  it('refuses a sender the operator did not name, even with a valid PDF', () => {
    expect(decideMail(mailOf({ from: 'billing@lookalike-supplier.example' }), POLICY)).toEqual({
      kind: 'reject',
      reason: 'SENDER_NOT_ALLOWED',
    });
  });

  it('refuses a named sender whose domain did not pass DMARC, so a forged From is not enough', () => {
    expect(
      decideMail(mailOf({ authenticationResults: ['mx.google.com; dmarc=fail'] }), POLICY),
    ).toEqual({ kind: 'reject', reason: 'SENDER_NOT_AUTHENTICATED' });
  });

  it('parses the allowed sender list, and refuses an empty or malformed one', () => {
    expect([...sendersOf(' A@x.example , b@y.example ')]).toEqual(['a@x.example', 'b@y.example']);
    expect(() => sendersOf('')).toThrow();
    expect(() => sendersOf('nobody')).toThrow();
  });
});

describe('what an email may carry', () => {
  it('accepts a real PDF and names the file from its hash, not from the sender', () => {
    const decision = decideMail(
      mailOf({
        attachments: [
          { filename: '..\\..\\evil.pdf', contentType: 'application/pdf', content: PDF },
        ],
      }),
      POLICY,
    );
    expect(decision.kind).toBe('accept');
    if (decision.kind === 'accept') {
      const sha = sha256OfBytes(PDF);
      expect(decision.files).toEqual([
        { name: `MAIL-7-${sha.slice(0, 12)}.pdf`, bytes: PDF, sha256: sha },
      ]);
    }
  });

  it('drops an attachment that only says it is a PDF', () => {
    const fake = new Uint8Array(Buffer.from('MZ not a pdf at all'));
    expect(
      decideMail(
        mailOf({
          attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', content: fake }],
        }),
        POLICY,
      ),
    ).toEqual({ kind: 'reject', reason: 'NO_PDF_ATTACHMENT' });
  });

  it('refuses a batch larger than three PDFs', () => {
    const many = Array.from({ length: 4 }, () => ({
      filename: 'a.pdf',
      contentType: 'application/pdf',
      content: PDF,
    }));
    expect(decideMail(mailOf({ attachments: many }), POLICY)).toEqual({
      kind: 'reject',
      reason: 'TOO_MANY_ATTACHMENTS',
    });
  });

  it('reports a bank-detail claim in the body, and still ignores the body', () => {
    const decision = decideMail(
      mailOf({ bodyText: 'Urgent: please pay this invoice into our new bank account details.' }),
      POLICY,
    );
    expect(decision.kind).toBe('accept');
    if (decision.kind === 'accept') {
      expect(decision.bodyFlags).toContain('PAYEE_CHANGE_CLAIM');
      expect(decision.files).toHaveLength(1);
    }
  });
});

/** A real email: a text part and a base64 PDF part, with a receiving server's Authentication-Results on top. */
function rawMessage(from: string, authentication: string, pdf: Uint8Array): Buffer {
  const encoded = Buffer.from(pdf).toString('base64');
  return Buffer.from(
    [
      `Authentication-Results: ${authentication}`,
      `From: Supplier Accounts <${from}>`,
      'To: signoff.demo@example.com',
      'Subject: Invoice',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Invoice attached.',
      '--b1',
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
      '--b1--',
      '',
    ].join('\r\n'),
  );
}

class FakeMailbox implements MailboxPort {
  readonly read: number[] = [];
  constructor(private readonly messages: Map<number, Buffer>) {}
  nextUid(): Promise<number> {
    return Promise.resolve(Math.max(0, ...this.messages.keys()) + 1);
  }
  unreadFrom(fromUid: number): Promise<readonly number[]> {
    return Promise.resolve(
      [...this.messages.keys()].filter((uid) => uid >= fromUid && !this.read.includes(uid)),
    );
  }
  source(uid: number): Promise<Buffer | null> {
    return Promise.resolve(this.messages.get(uid) ?? null);
  }
  markRead(uid: number): Promise<void> {
    this.read.push(uid);
    return Promise.resolve();
  }
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mail-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function optionsIn(folder: string): WatchOptions {
  return {
    policy: POLICY,
    inboxDir: join(folder, 'inbox'),
    logPath: join(folder, 'mail-log.jsonl'),
    now: () => new Date('2026-11-13T10:00:00.000Z'),
    say: () => undefined,
  };
}

describe('the mailbox watcher', () => {
  it('parses a real message: sender, topmost authentication header and the PDF bytes', async () => {
    const parsed = await parseMessage(3, rawMessage(SUPPLIER, PASS, PDF));
    expect(parsed.from).toBe(SUPPLIER);
    expect(parsed.authenticationResults[0]).toContain('dmarc=pass');
    expect(Buffer.from(parsed.attachments[0]?.content ?? []).equals(Buffer.from(PDF))).toBe(true);
  });

  it('copies an accepted PDF into the inbox byte for byte, so its fingerprint matches the evidence', async () => {
    const box = new FakeMailbox(new Map([[5, rawMessage(SUPPLIER, PASS, PDF)]]));
    const next = await pollOnce(box, 5, optionsIn(dir));
    expect(next).toBe(6);
    const files = readdirSync(join(dir, 'inbox'));
    expect(files).toHaveLength(1);
    const bytes = readFileSync(join(dir, 'inbox', files[0] ?? ''));
    expect(sha256OfBytes(new Uint8Array(bytes))).toBe(sha256OfBytes(PDF));
    expect(box.read).toEqual([5]);
  });

  it('writes nothing to the inbox for a refused email, marks it read, and logs no address', async () => {
    const box = new FakeMailbox(
      new Map([[9, rawMessage('ceo@attacker.example', PASS.replace('supplier', 'attacker'), PDF)]]),
    );
    await pollOnce(box, 1, optionsIn(dir));
    expect(existsSync(join(dir, 'inbox'))).toBe(false);
    expect(box.read).toEqual([9]);
    const log = readFileSync(join(dir, 'mail-log.jsonl'), 'utf8');
    expect(JSON.parse(log)).toMatchObject({
      uid: 9,
      decision: 'reject',
      reason: 'SENDER_NOT_ALLOWED',
    });
    expect(log).not.toContain('attacker');
  });

  it('does not deliver a message twice when it was decided but could not be marked read', async () => {
    const box = new FakeMailbox(new Map([[7, rawMessage(SUPPLIER, PASS, PDF)]]));
    const failingOnce = Object.assign(Object.create(box) as FakeMailbox, {
      markRead: () => Promise.reject(new Error('read ECONNRESET')),
    });
    await expect(pollOnce(failingOnce, 7, optionsIn(dir))).rejects.toThrow('ECONNRESET');
    // The next check finds the message still unread; it is only marked read, not delivered or logged again.
    await pollOnce(box, 7, optionsIn(dir));
    expect(box.read).toEqual([7]);
    expect(readdirSync(join(dir, 'inbox'))).toHaveLength(1);
    const lines = readFileSync(join(dir, 'mail-log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('leaves email that arrived before it started alone', async () => {
    const box = new FakeMailbox(new Map([[2, rawMessage(SUPPLIER, PASS, PDF)]]));
    const next = await pollOnce(box, 3, optionsIn(dir));
    expect(next).toBe(3);
    expect(box.read).toEqual([]);
    expect(existsSync(join(dir, 'inbox'))).toBe(false);
  });
});

describe('the watcher at its edges', () => {
  it('records a message whose source has gone as refused, and prints a line by default', async () => {
    const box = new FakeMailbox(new Map());
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
      lines.push(String(text));
      return true;
    });
    try {
      const { policy, inboxDir, logPath } = optionsIn(dir);
      const entry = await handleMessage(box, 4, { policy, inboxDir, logPath });
      expect(entry).toMatchObject({ uid: 4, decision: 'reject', reason: 'NO_PDF_ATTACHMENT' });
    } finally {
      spy.mockRestore();
    }
    expect(lines.join('')).toContain('mail 4: not accepted (NO_PDF_ATTACHMENT)');
  });

  it('says when the body made a claim it ignored', async () => {
    const said: string[] = [];
    const raw = Buffer.from(
      rawMessage(SUPPLIER, PASS, PDF)
        .toString('latin1')
        .replace('Invoice attached.', 'Please pay into our new bank account details.'),
      'latin1',
    );
    const box = new FakeMailbox(new Map([[8, raw]]));
    await pollOnce(box, 8, {
      ...optionsIn(dir),
      say: (line) => {
        said.push(line);
      },
    });
    expect(said[0]).toContain('PAYEE_CHANGE_CLAIM, and is ignored');
  });
});
