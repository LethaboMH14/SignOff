// Owner notifications: one plain-language message for each step an invoice takes, from "received" to "paid",
// plus the high-value approval request. Messages go to a local file the console reads (always) and to Telegram
// when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. Nothing secret is written: no keys, seeds or tokens, only
// the invoice file name, the step, the reason in words, and the public ledger hash.
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';

import { reasonTextOf } from '../../apps/console/src/model/reasons.js';

/** One line of the agent's move log, as far as notifications need it. */
export interface AgentMove {
  readonly at: string;
  readonly correlationId: string;
  readonly toState: string;
  readonly actor: string;
  readonly reasonCode: string;
  readonly ledgerHash?: string | null;
}

export interface OwnerNotice {
  readonly at: string;
  /** Which step on the agent map this message belongs to. */
  readonly step: string;
  readonly tone: 'info' | 'good' | 'warn';
  readonly text: string;
  readonly correlationId: string | null;
}

const EXPLORER = 'https://testnet.xrpl.org/transactions/';

/** The owner's message for one move, or null for a move the owner does not need to hear about. */
export function noticeFor(move: AgentMove, invoiceLabel: string): OwnerNotice | null {
  const base = { at: move.at, correlationId: move.correlationId };
  const why = reasonTextOf(move.reasonCode);
  switch (move.toState) {
    case 'RECEIVED':
      return { ...base, step: 'intake', tone: 'info', text: `Invoice ${invoiceLabel} received.` };
    case 'QUARANTINED':
      return {
        ...base,
        step: move.actor === 'screen' ? 'screen' : 'intake',
        tone: 'warn',
        text: `Invoice ${invoiceLabel} stopped before the AI read it. ${why} Nothing was paid.`,
      };
    case 'EXTRACTED':
      return {
        ...base,
        step: 'extractor',
        tone: 'info',
        text: `Invoice ${invoiceLabel} read: supplier, amount and order number found.`,
      };
    case 'EVIDENCE_VERIFIED':
      return {
        ...base,
        step: 'verifier',
        tone: 'info',
        text: `Invoice ${invoiceLabel}: every field checked against the invoice text.`,
      };
    case 'WARDEN_ELIGIBLE':
      return {
        ...base,
        step: 'matcher',
        tone: 'info',
        text: `Invoice ${invoiceLabel} matches the purchase order and the goods received. Sent to the Warden.`,
      };
    case 'HELD':
      return {
        ...base,
        step: 'hold',
        tone: 'warn',
        text: `Invoice ${invoiceLabel} is on hold. ${why} Nothing was paid.`,
      };
    case 'SIGNED':
      return {
        ...base,
        step: 'signer',
        tone: 'info',
        text: `Invoice ${invoiceLabel}: the Warden's rules passed. The payment is ready to send (a big one also waits for your phone).`,
      };
    case 'SUBMITTED':
      return {
        ...base,
        step: 'submitter',
        tone: 'info',
        text: `Invoice ${invoiceLabel}: payment handed to the XRP Ledger (Testnet) for its signatures.`,
      };
    case 'VALIDATED':
    case 'RECONCILED': {
      if (move.toState === 'VALIDATED') return null;
      const link = move.ledgerHash ? ` Proof: ${EXPLORER}${move.ledgerHash}` : '';
      return {
        ...base,
        step: 'paid',
        tone: 'good',
        text: `Invoice ${invoiceLabel} paid in Testnet RLUSD and reconciled.${link} The supplier's rand payout is simulated.`,
      };
    }
    case 'FAILED':
    case 'RECONCILIATION_EXCEPTION':
      return {
        ...base,
        step: 'hold',
        tone: 'warn',
        text: `Invoice ${invoiceLabel} needs a person to check it. ${why}`,
      };
    default:
      return null;
  }
}

/** The owner's message when the Warden asks for the high-value approval, read from its output line. */
export function approvalNoticeFrom(line: string, at: Date): OwnerNotice | null {
  const match =
    /owner approval requested \((pushed to the phone|open this link on the phone)\): (https:\/\/\S+)/.exec(
      line,
    );
  if (match === null) return null;
  const pushed = match[1] === 'pushed to the phone';
  return {
    at: at.toISOString(),
    step: 'approver',
    tone: 'warn',
    text: pushed
      ? 'A high-value payment needs your approval. Open the request in Xaman on your phone.'
      : `A high-value payment needs your approval. Open in Xaman: ${String(match[2])}`,
    correlationId: null,
  };
}

export interface NotifierOptions {
  /** The file the console reads; one JSON notice per line. */
  readonly file: string;
  readonly telegram: { readonly token: string; readonly chatId: string } | null;
  readonly fetchFn?: typeof fetch;
  readonly onError?: (message: string) => void;
}

export interface Notifier {
  send(notice: OwnerNotice): Promise<void>;
}

export function createNotifier(options: NotifierOptions): Notifier {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    async send(notice) {
      // The demo folder outside the repository, passed in by the launcher.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      appendFileSync(options.file, `${JSON.stringify(notice)}\n`);
      if (options.telegram === null) return;
      try {
        const res = await fetchFn(
          `https://api.telegram.org/bot${options.telegram.token}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: options.telegram.chatId,
              text: `SignOff (Testnet): ${notice.text}`,
              disable_web_page_preview: true,
            }),
          },
        );
        if (!res.ok) options.onError?.(`Telegram refused a message (HTTP ${String(res.status)})`);
      } catch {
        options.onError?.('Telegram could not be reached');
      }
    },
  };
}

/**
 * Follows the agent's move log from its current end and calls back for each new move. The file is read in full
 * on each tick (it is small); moves already seen are skipped by their position.
 */
export function followAgentLog(
  path: string,
  onMove: (move: AgentMove) => void,
  pollMs = 1000,
): () => void {
  // The agent log in the demo folder outside the repository, passed in by the launcher.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  let seen = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
  const timer = setInterval(() => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!existsSync(path) || statSync(path).size === 0) return;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(seen)) {
      try {
        onMove(JSON.parse(line) as AgentMove);
      } catch {
        // A partly written line is read again on the next tick.
        return;
      }
      seen += 1;
    }
  }, pollMs);
  return () => {
    clearInterval(timer);
  };
}
