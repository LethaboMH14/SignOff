import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import { MAX_INVOICE_BYTES } from '../intake/intake.js';
import { type ScreenCode, screenPages } from '../screen/injection.js';

/**
 * Which emailed invoices may enter the agent's inbox. An email is hostile content (R-13): its body is never given to
 * a model, and its claims change nothing. Only a PDF attachment can become an invoice, and only from a sender the
 * operator named whose domain the receiving server authenticated. Everything after that is the normal pipeline: the
 * screen, extraction, matching and the Warden, which pays only the supplier's verified payout record.
 */

export interface MailPolicy {
  /** Sender addresses allowed to submit invoices, in lower case. */
  readonly allowedSenders: ReadonlySet<string>;
  /**
   * The receiving server's name in its Authentication-Results header, for example mx.google.com. Only the topmost
   * header with this name is trusted; a sender can write any header lower down.
   */
  readonly authservId: string;
}

export interface MailAttachment {
  readonly filename: string | null;
  readonly contentType: string;
  readonly content: Uint8Array;
}

/** The parts of one parsed email that the decision reads. */
export interface ParsedMail {
  readonly uid: number;
  readonly from: string | null;
  /** Every Authentication-Results header, topmost first, as written in the message. */
  readonly authenticationResults: readonly string[];
  readonly attachments: readonly MailAttachment[];
  readonly bodyText: string;
}

export type MailRejection =
  'SENDER_NOT_ALLOWED' | 'SENDER_NOT_AUTHENTICATED' | 'NO_PDF_ATTACHMENT' | 'TOO_MANY_ATTACHMENTS';

export interface AcceptedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export type MailDecision =
  | {
      readonly kind: 'accept';
      readonly files: readonly AcceptedFile[];
      /** Attachments that were not usable PDFs and were dropped. */
      readonly skipped: number;
      /** What the screen found in the body. The body is still ignored; this is only reported. */
      readonly bodyFlags: readonly ScreenCode[];
    }
  | { readonly kind: 'reject'; readonly reason: MailRejection };

/** The most PDFs one email may carry. More than this looks like a batch someone should look at. */
export const MAX_PDFS_PER_MAIL = 3;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function isPdf(attachment: MailAttachment): boolean {
  const named =
    attachment.contentType.toLowerCase() === 'application/pdf' ||
    (attachment.filename ?? '').toLowerCase().endsWith('.pdf');
  const bytes = attachment.content;
  return (
    named &&
    bytes.length > PDF_MAGIC.length &&
    bytes.length <= MAX_INVOICE_BYTES &&
    Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).equals(Buffer.from(PDF_MAGIC))
  );
}

/** The bare address in a From value such as "Thandi <thandi@example.co.za>", in lower case, or null. */
export function addressOf(from: string | null): string | null {
  if (from === null) {
    return null;
  }
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  const bare = angled?.[1] ?? from.trim();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(bare) ? bare.toLowerCase() : null;
}

/**
 * Whether the receiving server says the From domain passed DMARC. Only the topmost Authentication-Results header that
 * names our server counts: it is the one our own server added on arrival.
 */
export function dmarcPassed(headers: readonly string[], authservId: string): boolean {
  const ours = headers.find(
    (value) => value.trim().toLowerCase().split(';')[0]?.trim() === authservId.toLowerCase(),
  );
  return ours !== undefined && /\bdmarc\s*=\s*pass\b/i.test(ours);
}

export function decideMail(mail: ParsedMail, policy: MailPolicy): MailDecision {
  const sender = addressOf(mail.from);
  if (sender === null || !policy.allowedSenders.has(sender)) {
    return { kind: 'reject', reason: 'SENDER_NOT_ALLOWED' };
  }
  if (!dmarcPassed(mail.authenticationResults, policy.authservId)) {
    return { kind: 'reject', reason: 'SENDER_NOT_AUTHENTICATED' };
  }
  const pdfs = mail.attachments.filter(isPdf);
  if (pdfs.length === 0) {
    return { kind: 'reject', reason: 'NO_PDF_ATTACHMENT' };
  }
  if (pdfs.length > MAX_PDFS_PER_MAIL) {
    return { kind: 'reject', reason: 'TOO_MANY_ATTACHMENTS' };
  }
  // The file name comes from the message number and the content hash, never from the sender's file name.
  const files = pdfs.map((pdf) => {
    const sha256 = sha256OfBytes(pdf.content);
    return {
      name: `MAIL-${String(mail.uid)}-${sha256.slice(0, 12)}.pdf`,
      bytes: pdf.content,
      sha256,
    };
  });
  return {
    kind: 'accept',
    files,
    skipped: mail.attachments.length - pdfs.length,
    bodyFlags: screenPages([mail.bodyText]).codes,
  };
}

/** The allowed senders from a comma-separated list, in lower case. */
export function sendersOf(text: string): ReadonlySet<string> {
  const senders = text
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  if (senders.length === 0 || senders.some((entry) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))) {
    throw new Error('SIGNOFF_MAIL_ALLOWED_SENDERS must list one or more email addresses');
  }
  return new Set(senders);
}
