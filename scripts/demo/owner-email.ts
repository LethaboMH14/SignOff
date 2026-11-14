// Owner notices by email. The demo mailbox sends them to one address the owner names in OWNER_NOTIFY_EMAIL. Nothing
// is sent unless that variable is set. Testnet only: every notice ends with a line saying so. No password is printed.
import { createRequire } from 'node:module';

import type { OwnerNotice } from './owner-notify.js';

/** The part of a mail transport this code uses. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

interface NodemailerModule {
  createTransport(options: { service: string; auth: { user: string; pass: string } }): {
    sendMail(message: object): Promise<unknown>;
  };
}

/** An SMTP transport through Gmail, with the demo mailbox's own app password. Loaded lazily, only when used. */
export function gmailTransport(user: string, password: string): MailTransport {
  const load = createRequire(import.meta.url);
  const nodemailer = load('nodemailer') as NodemailerModule;
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass: password },
  });
  return { sendMail: (message) => transport.sendMail(message) };
}

const FOOTER =
  'Testnet only. Invoices, suppliers and buyers are fictional; Testnet RLUSD has no value; the rand payout is simulated.';

/** The subject and body of one notice, in plain words. */
export function emailFor(notice: OwnerNotice): { subject: string; text: string } {
  const tag = notice.tone === 'good' ? 'Paid' : notice.tone === 'warn' ? 'Needs you' : 'Update';
  return {
    subject: `SignOff (Testnet): ${tag}, ${notice.step}`,
    text: `${notice.text}\n\n${FOOTER}\n`,
  };
}
