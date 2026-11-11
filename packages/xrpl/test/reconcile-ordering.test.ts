import { describe, expect, it } from 'vitest';
import type { LedgerLookup } from '../src/reconcile.js';
import type { LedgerPort } from '../src/port.js';
import { sendAndReconcile, type SendPlan } from '../src/reliable.js';
import { memoryJournalStore } from '../src/store.js';

const NOW = new Date('2026-11-10T10:00:00.000Z');
const LAST_LEDGER_SEQUENCE = 100;

const unused = (): Promise<never> => Promise.reject(new Error('not used by this test'));

/** A port whose validated index, submit and lookup are scripted. Every other method must not be called. */
function scriptedPort(
  parts: Pick<LedgerPort, 'validatedLedgerIndex' | 'submit' | 'lookup'>,
): LedgerPort {
  return {
    endpoint: 'wss://s.altnet.rippletest.net:51233',
    networkId: unused,
    baseFeeDrops: unused,
    reserves: unused,
    account: unused,
    trustLine: unused,
    autofill: unused,
    fund: unused,
    disconnect: () => Promise.resolve(),
    ...parts,
  };
}

const ACCEPTED = { engineResult: 'tesSUCCESS', accepted: true, applied: true };

function planWithNoValue(): SendPlan {
  return {
    paymentId: 'ordering',
    attempt: 1,
    txBlob: 'BLOB',
    hash: 'HASH',
    lastLedgerSequence: LAST_LEDGER_SEQUENCE,
    expected: { kind: 'xrp', drops: '1000' },
  };
}

describe('reconciliation ordering', () => {
  it('reads the validated ledger before the lookup, so a transaction validated in between is not declared expired', async () => {
    let validated = 99;
    let included = false;
    const port = scriptedPort({
      validatedLedgerIndex: () => Promise.resolve(validated),
      submit: () => Promise.resolve(ACCEPTED),
      lookup: (): Promise<LedgerLookup> => {
        if (included) {
          return Promise.resolve({
            status: 'validated',
            engineResult: 'tesSUCCESS',
            ledgerIndex: LAST_LEDGER_SEQUENCE,
            delivered: { kind: 'xrp', drops: '1000' },
          });
        }
        // While this lookup is in flight, the transaction is validated in ledger 100 and ledger 103 closes.
        included = true;
        validated = 103;
        return Promise.resolve({ status: 'not-validated' });
      },
    });
    const decision = await sendAndReconcile(planWithNoValue(), {
      port,
      journal: memoryJournalStore(),
      now: () => NOW,
      sleep: () => Promise.resolve(),
      pollMs: 0,
      maxPolls: 5,
    });
    expect(decision).toEqual({ kind: 'paid', ledgerIndex: LAST_LEDGER_SEQUENCE });
  });

  it('declares expiry only after a validated ledger is beyond the safety margin, without the hash', async () => {
    let validated = 99;
    let reads = 0;
    const port = scriptedPort({
      validatedLedgerIndex: () => {
        reads += 1;
        validated += 1;
        return Promise.resolve(validated);
      },
      submit: () => Promise.resolve(ACCEPTED),
      lookup: () => Promise.resolve({ status: 'not-validated' }),
    });
    const decision = await sendAndReconcile(planWithNoValue(), {
      port,
      journal: memoryJournalStore(),
      now: () => NOW,
      sleep: () => Promise.resolve(),
      pollMs: 0,
      maxPolls: 20,
    });
    expect(decision).toEqual({ kind: 'expired' });
    // Validated ledgers 100, 101, 102 are within the margin (LLS + 2); 103 is the first beyond it.
    expect(reads).toBe(4);
  });
});
