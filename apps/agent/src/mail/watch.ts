/* eslint-disable security/detect-non-literal-fs-filename -- the inbox and log paths are named by the operator at start-up */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { simpleParser } from 'mailparser';

import { decideMail, type MailDecision, type MailPolicy, type ParsedMail } from './admit.js';

/**
 * Follows one mailbox and copies the PDF invoices that pass `decideMail` into the agent's inbox. From there the agent
 * treats them like any other file. Only messages that arrive after the watcher starts are read, so an old unread email
 * cannot be paid by surprise. Each message is marked as read once it is decided, accepted or not.
 */

/** The few mailbox calls the watcher needs. The IMAP adapter implements them; tests use a fake. */
export interface MailboxPort {
  /** The UID the next message will get. Messages below it existed before the watcher started. */
  nextUid(): Promise<number>;
  /** UIDs of unread messages at or above `fromUid`, ascending. */
  unreadFrom(fromUid: number): Promise<readonly number[]>;
  /** The full message source. */
  source(uid: number): Promise<Buffer | null>;
  markRead(uid: number): Promise<void>;
}

export interface MailLogEntry {
  readonly at: string;
  readonly uid: number;
  readonly decision: 'accept' | 'reject';
  readonly reason: string | null;
  readonly files: readonly string[];
  readonly skippedAttachments: number;
  /** Screen codes found in the email body. The body is ignored either way. */
  readonly bodyFlags: readonly string[];
}

export interface WatchOptions {
  readonly policy: MailPolicy;
  readonly inboxDir: string;
  /** A JSON-lines record of each decision. It holds no address, subject or body text. */
  readonly logPath: string;
  readonly now?: () => Date;
  readonly say?: (line: string) => void;
}

/** Reads a raw message into the parts the decision needs. Unfolds the Authentication-Results headers, topmost first. */
export async function parseMessage(uid: number, raw: Buffer): Promise<ParsedMail> {
  const parsed = await simpleParser(raw);
  const senders = parsed.from?.value ?? [];
  const authenticationResults = parsed.headerLines
    .filter((header) => header.key.toLowerCase() === 'authentication-results')
    .map((header) =>
      header.line
        .replace(/^[^:]*:/, '')
        .replace(/\r?\n[ \t]+/g, ' ')
        .trim(),
    );
  return {
    uid,
    from: senders.length === 1 ? (senders[0]?.address ?? null) : null,
    authenticationResults,
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.contentType,
      content: new Uint8Array(attachment.content),
    })),
    bodyText: parsed.text ?? '',
  };
}

/** Writes accepted files into the inbox: first under a temporary name, then renamed, so the agent never reads half a file. */
function deliver(decision: MailDecision, inboxDir: string): readonly string[] {
  if (decision.kind !== 'accept') {
    return [];
  }
  mkdirSync(inboxDir, { recursive: true });
  return decision.files.map((file) => {
    const partial = join(inboxDir, `${file.name}.partial`);
    writeFileSync(partial, file.bytes);
    renameSync(partial, join(inboxDir, file.name));
    return file.name;
  });
}

/** The logged decision for a message UID, or null. A malformed log line is ignored. */
function decidedBefore(logPath: string, uid: number): MailLogEntry | null {
  if (!existsSync(logPath)) {
    return null;
  }
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const entry = JSON.parse(line) as MailLogEntry;
      if (entry.uid === uid) {
        return entry;
      }
    } catch {
      // A torn last line from a crash is not a decision.
    }
  }
  return null;
}

/** Decides one message, delivers what is accepted, records the decision and marks the message read. */
export async function handleMessage(
  port: MailboxPort,
  uid: number,
  options: WatchOptions,
): Promise<MailLogEntry> {
  const now = options.now ?? (() => new Date());
  // A message decided before but not marked read (the connection dropped in between) is only marked read now. Deciding
  // it again would deliver the same invoice twice.
  const earlier = decidedBefore(options.logPath, uid);
  if (earlier !== null) {
    await port.markRead(uid);
    return earlier;
  }
  const raw = await port.source(uid);
  let decision: MailDecision;
  if (raw === null) {
    decision = { kind: 'reject', reason: 'NO_PDF_ATTACHMENT' };
  } else {
    decision = decideMail(await parseMessage(uid, raw), options.policy);
  }
  const files = deliver(decision, options.inboxDir);
  const entry: MailLogEntry = {
    at: now().toISOString(),
    uid,
    decision: decision.kind,
    reason: decision.kind === 'reject' ? decision.reason : null,
    files,
    skippedAttachments: decision.kind === 'accept' ? decision.skipped : 0,
    bodyFlags: decision.kind === 'accept' ? decision.bodyFlags : [],
  };
  appendFileSync(options.logPath, `${JSON.stringify(entry)}\n`);
  await port.markRead(uid);
  const say = options.say ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (decision.kind === 'accept') {
    const flags =
      entry.bodyFlags.length > 0
        ? `; the email body says ${entry.bodyFlags.join(', ')}, and is ignored`
        : '';
    say(`mail ${String(uid)}: invoice accepted into the inbox as ${files.join(', ')}${flags}`);
  } else {
    say(`mail ${String(uid)}: not accepted (${String(entry.reason)})`);
  }
  return entry;
}

/** One pass: every unread message at or above `fromUid`. Returns the UID to start from next time. */
export async function pollOnce(
  port: MailboxPort,
  fromUid: number,
  options: WatchOptions,
): Promise<number> {
  let next = fromUid;
  for (const uid of await port.unreadFrom(fromUid)) {
    await handleMessage(port, uid, options);
    next = Math.max(next, uid + 1);
  }
  return next;
}

/** A mail check or connection that did not finish in time. Its connection can no longer be trusted. */
export class StallError extends Error {
  constructor(ms: number) {
    super(`the mail server did not answer within ${String(ms / 1000)} seconds`);
    this.name = 'StallError';
  }
}

/** Rejects with a StallError if `work` does not settle within `ms`. The stalled work is left to finish or fail on its own. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StallError(ms));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('unknown'));
      },
    );
  });
}
