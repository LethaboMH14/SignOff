import { describe, expect, it } from 'vitest';

import { buildAuditExport } from '../../agent/src/audit/export.js';
import { type TransitionRecord } from '../../agent/src/log/transition-log.js';
import { invoiceDetailOf } from '../src/server/invoice-view.js';
import { type ProposalView, type SupplierView } from '../src/server/warden-reads.js';

const CORRELATION = 'a'.repeat(64);
const OBLIGATION = 'd'.repeat(64);
const ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const ACCOUNT = 'rSupplierAccountForTestsWXYZ';
const NOW = new Date('2026-11-11T09:30:00.000Z');

function move(
  seq: number,
  toState: string,
  reasonCode: string,
  attemptId: string | null = null,
): TransitionRecord {
  return {
    seq,
    at: `2026-11-11T09:0${String(seq)}:00.000Z`,
    correlationId: CORRELATION,
    obligationKey: seq >= 2 ? OBLIGATION : null,
    fromState: null,
    toState: toState as TransitionRecord['toState'],
    actor: toState === 'RECONCILED' ? 'reconciler' : 'matcher',
    reasonCode,
    reasons: ['document text that must never reach the browser'],
    policyVersion: '2026-11-10.1',
    attemptId,
    ledgerHash: null,
    evidence: {
      fileSha256: 'e'.repeat(64),
      recordSha256s: ['1'.repeat(64)],
      quoteSha256s: [],
      model: null,
      modelCalls: 2,
      screenCodes: [],
    },
  };
}

const HELD_LOG: TransitionRecord[] = [
  move(1, 'RECEIVED', 'OK'),
  move(2, 'EXTRACTED', 'OK'),
  move(3, 'HELD', 'MISSING_EVIDENCE'),
];

const SUPPLIER: SupplierView = {
  supplierId: 'SUP-ABCD1234',
  status: 'active',
  payee: { address: ACCOUNT, destinationTag: null },
  change: {
    changeId: 'change-1',
    status: 'requested',
    requestedAt: '2026-11-11T08:00:00.000Z',
    coolingOffUntil: null,
  },
};

const PAID_PROPOSAL: ProposalView = {
  attemptId: ATTEMPT,
  decision: 'ALLOW',
  policyVersion: '2026-11-10.1',
  evaluatedAt: '2026-11-11T09:03:00.000Z',
  reasons: [],
  payment: {
    status: 'paid',
    supplierId: 'SUP-ABCD1234',
    currency: 'USD',
    amountMinor: 125000,
    ledgerIndex: 99,
    engineResult: 'tesSUCCESS',
    transactionHash: 'F'.repeat(64),
  },
};

describe('the held-invoice view', () => {
  it('shows the same moves, in the same order, as the audit export for the same obligation', () => {
    const log: TransitionRecord[] = [
      move(1, 'RECEIVED', 'OK'),
      move(2, 'EXTRACTED', 'OK'),
      move(3, 'WARDEN_ELIGIBLE', 'OK', ATTEMPT),
      move(4, 'RECONCILED', 'OK', ATTEMPT),
    ];
    const detail = invoiceDetailOf({
      records: log,
      correlationId: CORRELATION,
      proposal: PAID_PROPOSAL,
      supplier: SUPPLIER,
    });
    const exported = buildAuditExport({
      records: log,
      selector: { obligationKey: OBLIGATION, correlationId: null },
      wardenLines: [],
      now: NOW,
    });
    expect(detail?.history.map((item) => item.seq)).toEqual(
      exported.agentTransitions.map((item) => item.seq),
    );
    expect(detail?.history.map((item) => item.fileSha256)).toEqual(
      exported.agentTransitions.map((item) => item.evidence.fileSha256),
    );
  });

  it('names the failed rule and its next step for a held invoice, and never shows it as paid', () => {
    const detail = invoiceDetailOf({
      records: HELD_LOG,
      correlationId: CORRELATION,
      proposal: null,
      supplier: null,
    });
    expect(detail).not.toBeNull();
    expect(detail?.displayState).toBe('Held');
    expect(detail?.failedRule?.code).toBe('MISSING_EVIDENCE');
    expect(detail?.nextAction).toBe(
      'Link the purchase order or goods receipt, then propose the invoice again.',
    );
    expect(detail?.wardenDecision).toBeNull();
  });

  it('keeps document text out of the history: each move carries its reason words, never the agent reasons', () => {
    const detail = invoiceDetailOf({
      records: HELD_LOG,
      correlationId: CORRELATION,
      proposal: null,
      supplier: null,
    });
    expect(JSON.stringify(detail)).not.toContain('document text that must never reach the browser');
    expect(detail?.history.at(-1)?.reason).toBe('A record needed to check the invoice is missing.');
  });

  it('masks the enrolled account and never lets the console approve a payout change', () => {
    const detail = invoiceDetailOf({
      records: HELD_LOG,
      correlationId: CORRELATION,
      proposal: null,
      supplier: SUPPLIER,
    });
    expect(detail?.enrolledPayee).toBe('…WXYZ');
    expect(JSON.stringify(detail)).not.toContain(ACCOUNT);
    expect(detail?.payoutChange?.status).toBe('requested');
    expect(detail?.payoutChange?.approvalAllowed).toBe(false);
    expect(detail?.payoutChange?.why).toContain('second operator');
  });

  it('reports no payout change when the supplier has none pending', () => {
    const detail = invoiceDetailOf({
      records: HELD_LOG,
      correlationId: CORRELATION,
      proposal: null,
      supplier: { ...SUPPLIER, change: null },
    });
    expect(detail?.payoutChange?.status).toBe('none');
  });

  it('reports nothing for an invoice the log does not hold', () => {
    expect(
      invoiceDetailOf({
        records: HELD_LOG,
        correlationId: 'b'.repeat(64),
        proposal: null,
        supplier: null,
      }),
    ).toBeNull();
  });
});
