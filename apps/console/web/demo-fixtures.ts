/**
 * FIXTURE DATA for the demo page only (demo.html). Every value here is invented for the demonstration: invoice numbers,
 * supplier codes, hashes and the ledger link are placeholders, and no money moved. The demo page labels itself as a
 * fixture, so none of this can pass for live data. It is not used by the console.
 */
import type { DeskData, PendingRaise } from './api.js';
import { DISPLAY_STATES, type DeskRow, type DisplayState } from '../src/model/desk.js';
import type { InvoiceDetail } from '../src/server/invoice-view.js';
import type { ReceiptView } from '../src/server/receipt.js';

const NOW = '2026-11-12T08:30:00.000Z';
const PLACEHOLDER_HASH = '0'.repeat(64);

function countsOf(rows: readonly DeskRow[]): Record<DisplayState, number> {
  const counts = Object.fromEntries(DISPLAY_STATES.map((state) => [state, 0])) as Record<
    DisplayState,
    number
  >;
  for (const row of rows) {
    counts[row.displayState] += 1;
  }
  return counts;
}

const ROWS: readonly DeskRow[] = [
  {
    rowId: 'r-held',
    invoiceRef: 'INV-24018',
    attemptId: null,
    supplierId: 'SUP-0412',
    amountMinor: 480000,
    currency: 'ZAR',
    displayState: 'Held',
    reasonCode: 'PAYEE_CHANGED',
    reason:
      'The enrolled payout account for this supplier changed. A person must confirm it first.',
    modelCalls: 2,
    updatedAt: '2026-11-12T08:12:00.000Z',
  },
  {
    rowId: 'r-paid',
    invoiceRef: 'INV-24017',
    attemptId: 'att-24017',
    supplierId: 'SUP-0107',
    amountMinor: 125000,
    currency: 'ZAR',
    displayState: 'Paid',
    reasonCode: null,
    reason: 'Validated on the ledger and reconciled.',
    modelCalls: 2,
    updatedAt: '2026-11-12T07:58:00.000Z',
  },
  {
    rowId: 'r-progress',
    invoiceRef: 'INV-24019',
    attemptId: null,
    supplierId: 'SUP-0233',
    amountMinor: 89950,
    currency: 'ZAR',
    displayState: 'In progress',
    reasonCode: null,
    reason: 'Signed by the Warden. Waiting for the ledger to validate it.',
    modelCalls: 1,
    updatedAt: '2026-11-12T08:25:00.000Z',
  },
  {
    rowId: 'r-confirm',
    invoiceRef: 'INV-24020',
    attemptId: null,
    supplierId: null,
    amountMinor: 31000,
    currency: 'ZAR',
    displayState: 'Needs a person',
    reasonCode: 'PO_NOT_FOUND',
    reason: 'No purchase order matches this invoice. A person must check the order.',
    modelCalls: 1,
    updatedAt: '2026-11-12T08:02:00.000Z',
  },
  {
    rowId: 'r-notconf',
    invoiceRef: 'INV-24016',
    attemptId: 'att-24016',
    supplierId: 'SUP-0107',
    amountMinor: 52500,
    currency: 'ZAR',
    displayState: 'Not confirmed',
    reasonCode: 'LEDGER_UNREADABLE',
    reason: 'The ledger did not answer clearly. Not paid until the ledger confirms it.',
    modelCalls: 2,
    updatedAt: '2026-11-11T16:40:00.000Z',
  },
  {
    rowId: 'r-refused',
    invoiceRef: 'INV-24015',
    attemptId: null,
    supplierId: 'SUP-0090',
    amountMinor: 700000,
    currency: 'ZAR',
    displayState: 'Refused',
    reasonCode: 'OVER_LIMIT',
    reason: 'This payment is above the per-payment limit. Lower limits apply at once.',
    modelCalls: 1,
    updatedAt: '2026-11-11T14:10:00.000Z',
  },
];

const RAISE: PendingRaise = {
  requestId: 'req-0042',
  requestedBy: 'another operator',
  expiresAt: '2026-11-12T20:00:00.000Z',
  perPaymentMinor: 6000000,
  supplierDailyMinor: 20000000,
  dailyTotalMinor: 60000000,
  approvalAllowed: true,
  why: 'A raised limit needs a second operator to approve it. You cannot approve your own request.',
};

/** The desk, with a held invoice first, a paid one, and a raised limit waiting for a second operator. */
export function deskFixture(): DeskData {
  return {
    asOf: NOW,
    mode: 'simulated',
    damagedLines: 0,
    overview: {
      paused: false,
      policyVersion: 'rules-v3',
      limits: {
        perPaymentMinor: 5000000,
        supplierDailyMinor: 20000000,
        dailyTotalMinor: 60000000,
      },
      usageToday: { day: '2026-11-12', totalMinor: 1385000 },
      pendingLimitChange: RAISE,
    },
    counts: countsOf(ROWS),
    rows: ROWS,
  };
}

/** The changed-payout hold: the rules passed, and the payout destination changed and stops the path. */
export function holdFixture(): InvoiceDetail {
  return {
    invoiceRef: 'INV-24018',
    attemptId: null,
    displayState: 'Held',
    supplierId: 'SUP-0412',
    amountMinor: 480000,
    currency: 'ZAR',
    failedRule: null,
    nextAction:
      'Ask the supplier to confirm the new payout account through the verified supplier record. Nothing is paid to the new account until a person confirms it.',
    enrolledPayee: '…4417',
    payoutChange: {
      status: 'requested',
      coolingOffUntil: '2026-11-14T08:30:00.000Z',
      approvalAllowed: false,
      why: 'A payout change is requested and not yet confirmed. The console does not approve payout changes.',
    },
    wardenDecision: {
      decision: 'ALLOW',
      policyVersion: 'rules-v3',
      evaluatedAt: '2026-11-12T08:14:00.000Z',
      reasonCodes: [],
    },
    history: [
      {
        seq: 1,
        at: '2026-11-12T08:03:00.000Z',
        actorLabel: 'Intake',
        stateLabel: 'Received',
        reasonCode: 'OK',
        reason: '',
        policyVersion: 'rules-v3',
        fileSha256: PLACEHOLDER_HASH,
        recordSha256s: [PLACEHOLDER_HASH],
      },
      {
        seq: 2,
        at: '2026-11-12T08:08:00.000Z',
        actorLabel: 'Verifier',
        stateLabel: 'Evidence checked against records',
        reasonCode: 'OK',
        reason: '',
        policyVersion: 'rules-v3',
        fileSha256: PLACEHOLDER_HASH,
        recordSha256s: [PLACEHOLDER_HASH, PLACEHOLDER_HASH],
      },
      {
        seq: 3,
        at: '2026-11-12T08:12:00.000Z',
        actorLabel: 'Matcher',
        stateLabel: 'Held for a person',
        reasonCode: 'PAYEE_CHANGED',
        reason:
          'The enrolled payout account for this supplier changed. A person must confirm it first.',
        policyVersion: 'rules-v3',
        fileSha256: PLACEHOLDER_HASH,
        recordSha256s: [PLACEHOLDER_HASH],
      },
    ],
  };
}

/** A validated receipt. The rand figure is a placeholder-rate simulation and is labelled as one. */
export function receiptFixture(): ReceiptView {
  return {
    state: 'receipt',
    invoiceRef: 'INV-24017',
    amount: '1,250.00',
    currency: 'ZAR',
    asset: 'Test-issued token (not RLUSD)',
    deliveredValue: '1,250.00',
    ledgerIndex: 88214531,
    explorerUrl: `https://testnet.xrpl.org/transactions/${PLACEHOLDER_HASH}`,
    rand: { label: 'SIMULATED', amount: '23,125.00', rate: '18.50' },
  };
}
