/* eslint-disable security/detect-non-literal-fs-filename -- temporary test folders created by this file */
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  approvalNoticeFrom,
  createNotifier,
  followAgentLog,
  noticeFor,
  type AgentMove,
} from './owner-notify.js';

const move = (toState: string, extra: Partial<AgentMove> = {}): AgentMove => ({
  at: '2026-11-13T19:00:00.000Z',
  correlationId: 'abc',
  toState,
  actor: 'matcher',
  reasonCode: 'OK',
  ...extra,
});

describe('owner notifications', () => {
  it('tells the owner each step in plain words, from received to paid', () => {
    const steps = [
      'RECEIVED',
      'EXTRACTED',
      'EVIDENCE_VERIFIED',
      'WARDEN_ELIGIBLE',
      'SIGNED',
      'SUBMITTED',
      'RECONCILED',
    ];
    const notices = steps.map((state) => noticeFor(move(state), 'INV-1'));
    expect(notices.every((n) => n?.text.includes('INV-1') === true)).toBe(true);
    expect(notices.at(-1)?.tone).toBe('good');
  });

  it('links the paid message to the public ledger record and labels the payout as simulated', () => {
    const notice = noticeFor(move('RECONCILED', { ledgerHash: 'ABC123' }), 'INV-1');
    expect(notice?.text).toContain('https://testnet.xrpl.org/transactions/ABC123');
    expect(notice?.text).toContain('simulated');
  });

  it('explains a quarantine in words and says nothing was paid', () => {
    const notice = noticeFor(
      move('QUARANTINED', { actor: 'screen', reasonCode: 'PAYEE_CHANGE_CLAIM' }),
      'INV-2',
    );
    expect(notice?.step).toBe('screen');
    expect(notice?.text).toContain('bank details have changed');
    expect(notice?.text).toContain('Nothing was paid');
  });

  it('stays quiet for steps the owner does not need', () => {
    expect(noticeFor(move('VALIDATED'), 'INV-1')).toBeNull();
    expect(noticeFor(move('SOMETHING_ELSE'), 'INV-1')).toBeNull();
  });

  it('turns the Warden approval line into a phone prompt', () => {
    const pushed = approvalNoticeFrom(
      'warden: owner approval requested (pushed to the phone): https://xumm.app/sign/x',
      new Date(0),
    );
    expect(pushed?.step).toBe('approver');
    expect(pushed?.text).toContain('Xaman');
    const link = approvalNoticeFrom(
      'warden: owner approval requested (open this link on the phone): https://xumm.app/sign/y',
      new Date(0),
    );
    expect(link?.text).toContain('https://xumm.app/sign/y');
    expect(approvalNoticeFrom('warden listening', new Date(0))).toBeNull();
  });

  it('writes every notice to the log file and sends it to Telegram when set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    const file = join(dir, 'n.jsonl');
    const sent: string[] = [];
    const fetchFn = ((url: string, init?: { body?: string }) => {
      sent.push(`${url} ${init?.body ?? ''}`);
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;
    const notifier = createNotifier({ file, telegram: { token: 't', chatId: '42' }, fetchFn });
    const notice = noticeFor(move('RECEIVED'), 'INV-3');
    if (notice === null) throw new Error('expected a notice');
    await notifier.send(notice);
    expect(readFileSync(file, 'utf8')).toContain('INV-3');
    expect(sent[0]).toContain('/bott/sendMessage');
    expect(sent[0]).toContain('"chat_id":"42"');
  });

  it('keeps the log when Telegram fails, and reports the failure without details', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    const file = join(dir, 'n.jsonl');
    const errors: string[] = [];
    const fetchFn = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    const notifier = createNotifier({
      file,
      telegram: { token: 't', chatId: '1' },
      fetchFn,
      onError: (m) => errors.push(m),
    });
    const notice = noticeFor(move('RECEIVED'), 'INV-4');
    if (notice === null) throw new Error('expected a notice');
    await notifier.send(notice);
    expect(readFileSync(file, 'utf8')).toContain('INV-4');
    expect(errors).toEqual(['Telegram could not be reached']);
  });

  it('follows the agent log from its end and reports only new moves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    const log = join(dir, 'agent.jsonl');
    writeFileSync(log, `${JSON.stringify(move('RECEIVED'))}\n`);
    const seen: string[] = [];
    const stop = followAgentLog(log, (m) => seen.push(m.toState), 10);
    appendFileSync(log, `${JSON.stringify(move('EXTRACTED'))}\n`);
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(seen).toEqual(['EXTRACTED']);
  });
});
