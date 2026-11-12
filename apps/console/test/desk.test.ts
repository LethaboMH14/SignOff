import { describe, expect, it } from 'vitest';

import {
  DISPLAY_STATES,
  type DisplayState,
  deskRowsOf,
  displayStateOf,
  type InvoiceRecord,
  type ProposalRecord,
  WARDEN_STATUSES,
  countsOf,
} from '../src/model/desk.js';
import { AGENT_STATES, type AgentState } from '../src/model/states.js';

const CORRELATION = 'a'.repeat(64);
const ATTEMPT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    correlationId: CORRELATION,
    attemptId: ATTEMPT,
    agentState: 'SUBMITTED',
    reasonCode: 'OK',
    at: '2026-11-11T09:00:00.000Z',
    modelCalls: 2,
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    attemptId: ATTEMPT,
    decision: 'ALLOW',
    reasonCodes: [],
    evaluatedAt: '2026-11-11T08:59:00.000Z',
    payment: {
      status: 'paid',
      supplierId: 'SUP-ABCD1234',
      currency: 'USD',
      amountMinor: 125000,
      ledgerIndex: 99,
      engineResult: 'tesSUCCESS',
    },
    ...overrides,
  };
}

describe('the display state rule', () => {
  it('shows Paid only when the Warden attempt is paid, the ledger validated, and reconciliation recorded, for every combination', () => {
    const agentStates: (AgentState | null)[] = [null, ...AGENT_STATES];
    const wardenStates: ((typeof WARDEN_STATUSES)[number] | null)[] = [null, ...WARDEN_STATUSES];
    let combinations = 0;
    for (const agentState of agentStates) {
      for (const wardenStatus of wardenStates) {
        for (const ledgerValidated of [true, false]) {
          combinations += 1;
          const state = displayStateOf({ agentState, wardenStatus, ledgerValidated });
          expect(DISPLAY_STATES).toContain(state);
          const allThree =
            wardenStatus === 'paid' && ledgerValidated && agentState === 'RECONCILED';
          expect(
            state === 'Paid',
            `${String(agentState)} / ${String(wardenStatus)} / ${String(ledgerValidated)}`,
          ).toBe(allThree);
          if (wardenStatus === 'paid' && !allThree) {
            expect(state).toBe('Not confirmed');
          }
        }
      }
    }
    expect(combinations).toBe((AGENT_STATES.length + 1) * (WARDEN_STATUSES.length + 1) * 2);
  });

  it('never shows Paid for an agent that only reached VALIDATED', () => {
    expect(
      displayStateOf({ agentState: 'VALIDATED', wardenStatus: 'paid', ledgerValidated: true }),
    ).toBe('Not confirmed');
  });

  it('shows Not confirmed when the agent says reconciled but the Warden has no paid attempt', () => {
    expect(
      displayStateOf({ agentState: 'RECONCILED', wardenStatus: 'awaiting', ledgerValidated: true }),
    ).toBe('Not confirmed');
  });

  it('maps the held, refused, expired and in-flight states to their own words', () => {
    const cases: [Parameters<typeof displayStateOf>[0], DisplayState][] = [
      [{ agentState: 'HELD', wardenStatus: null, ledgerValidated: false }, 'Held'],
      [{ agentState: 'WARDEN_ELIGIBLE', wardenStatus: 'held', ledgerValidated: false }, 'Held'],
      [
        { agentState: 'WARDEN_ELIGIBLE', wardenStatus: 'rejected', ledgerValidated: false },
        'Refused',
      ],
      [{ agentState: 'SUBMITTED', wardenStatus: 'expired', ledgerValidated: false }, 'Not paid'],
      [
        { agentState: 'SUBMITTED', wardenStatus: 'awaiting', ledgerValidated: false },
        'In progress',
      ],
      [{ agentState: 'SIGNED', wardenStatus: null, ledgerValidated: false }, 'In progress'],
      [{ agentState: 'FAILED', wardenStatus: null, ledgerValidated: false }, 'Failed'],
      [
        { agentState: 'RECONCILIATION_EXCEPTION', wardenStatus: null, ledgerValidated: false },
        'Needs a person',
      ],
      [
        { agentState: 'RECONCILIATION_EXCEPTION', wardenStatus: 'paid', ledgerValidated: true },
        'Not confirmed',
      ],
      [{ agentState: 'QUARANTINED', wardenStatus: null, ledgerValidated: false }, 'Quarantined'],
      [{ agentState: 'RECEIVED', wardenStatus: null, ledgerValidated: false }, 'Received'],
    ];
    for (const [input, expected] of cases) {
      expect(displayStateOf(input)).toBe(expected);
    }
  });
});

describe('the desk rows', () => {
  it('joins an agent invoice to its Warden attempt, and shows Paid only once both agree', () => {
    const rows = deskRowsOf(
      [invoice({ agentState: 'RECONCILED', reasonCode: 'OK' })],
      [proposal()],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowId: ATTEMPT,
      invoiceRef: 'aaaaaaaa',
      modelCalls: 2,
      attemptId: ATTEMPT,
      supplierId: 'SUP-ABCD1234',
      amountMinor: 125000,
      currency: 'USD',
      displayState: 'Paid',
    });
  });

  it('shows the Warden reason code, in plain words, for a held proposal', () => {
    const rows = deskRowsOf(
      [invoice({ agentState: 'WARDEN_ELIGIBLE', reasonCode: 'OK' })],
      [
        proposal({
          decision: 'HOLD',
          reasonCodes: ['PAUSED'],
          payment: null,
        }),
      ],
    );
    expect(rows[0]).toMatchObject({
      displayState: 'Held',
      reasonCode: 'PAUSED',
      reason: 'New payments are paused by the operator.',
    });
  });

  it('shows an invoice the Warden has not decided, from the agent alone', () => {
    const rows = deskRowsOf(
      [invoice({ attemptId: null, agentState: 'HELD', reasonCode: 'MISSING_EVIDENCE' })],
      [],
    );
    expect(rows[0]).toMatchObject({
      rowId: CORRELATION,
      attemptId: null,
      displayState: 'Held',
      reasonCode: 'MISSING_EVIDENCE',
    });
  });

  it('gives a reason with no code the words "No reason code is recorded", and never an invented sentence', () => {
    const rows = deskRowsOf(
      [invoice({ attemptId: null, agentState: 'RECEIVED', reasonCode: 'OK' })],
      [],
    );
    expect(rows[0]?.reason).toBe('No problem found at this step.');
    const bare = deskRowsOf([], [proposal({ decision: 'HOLD', reasonCodes: [], payment: null })]);
    expect(bare[0]?.reason).toBe('No reason code is recorded.');
    expect(bare[0]?.reasonCode).toBeNull();
  });

  it('counts every display state, including those with no rows', () => {
    const counts = countsOf(deskRowsOf([invoice({ agentState: 'RECONCILED' })], [proposal()]));
    expect(Object.keys(counts).sort()).toEqual([...DISPLAY_STATES].sort());
    expect(counts.Paid).toBe(1);
    expect(counts.Held).toBe(0);
  });

  it('lists the newest first', () => {
    const rows = deskRowsOf(
      [
        invoice({ correlationId: 'b'.repeat(64), attemptId: null, at: '2026-11-11T07:00:00.000Z' }),
        invoice({ correlationId: 'c'.repeat(64), attemptId: null, at: '2026-11-11T11:00:00.000Z' }),
      ],
      [],
    );
    expect(rows.map((row) => row.invoiceRef)).toEqual(['cccccccc', 'bbbbbbbb']);
  });
});
