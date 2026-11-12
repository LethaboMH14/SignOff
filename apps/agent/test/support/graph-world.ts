import type { SourceRecord } from '../../src/context/types.js';
import type { VerifiedInvoice } from '../../src/extract/verify.js';
import type { ModelClient, ModelRequest } from '../../src/model/types.js';
import type { GraphDeps, PaymentPort, PaymentSnapshot } from '../../src/graph/run.js';
import { LongTermFacts } from '../../src/context/memory.js';
import { MemoryCheckpointStore, type CheckpointStore } from '../../src/graph/checkpoint.js';

import { GOOD_REPLY, register, SUPPLIER_LIST } from './world.js';

/**
 * A scripted model for the graph tests. It picks a reply by the role of the call (the first line of its system prompt), so
 * a test decides what each agent says, call by call. Every call is recorded, so tests can count them.
 *
 * This is a test double. The experiment (apps/agent/src/experiment) calls real providers and never imports this file.
 */

export type Role = 'extractor' | 'procurement' | 'fraud' | 'reason';

export interface Script {
  readonly extractor?: readonly (string | Error)[];
  readonly procurement?: readonly (string | Error)[];
  readonly fraud?: readonly (string | Error)[];
  readonly reason?: readonly (string | Error)[];
}

export interface ScriptedModel extends ModelClient {
  readonly calls: { role: Role; messages: ModelRequest['messages'] }[];
}

const HEADERS: readonly (readonly [string, Role])[] = [
  ['# Procurement reviewer', 'procurement'],
  ['# Fraud reviewer', 'fraud'],
  ['# Reason drafter', 'reason'],
  ['You extract fields', 'extractor'],
  ['# Extractor', 'extractor'],
];

export function roleOf(system: string): Role {
  for (const [header, role] of HEADERS) {
    if (system.includes(header)) {
      return role;
    }
  }
  throw new Error('the system prompt is not one of the known roles');
}

export function scriptedModel(script: Script): ScriptedModel {
  const queues = new Map<Role, (string | Error)[]>([
    ['extractor', [...(script.extractor ?? [GOOD_REPLY])]],
    ['procurement', [...(script.procurement ?? [])]],
    ['fraud', [...(script.fraud ?? [])]],
    ['reason', [...(script.reason ?? [])]],
  ]);
  const calls: { role: Role; messages: ModelRequest['messages'] }[] = [];
  return {
    label: 'scripted:test',
    calls,
    complete(request: ModelRequest): Promise<{ text: string }> {
      const system = request.messages[0]?.content ?? '';
      const role = roleOf(system);
      calls.push({ role, messages: request.messages });
      const queue = queues.get(role) ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === undefined) {
        return Promise.reject(new Error(`no scripted reply left for ${role}`));
      }
      if (next instanceof Error) {
        return Promise.reject(next);
      }
      return Promise.resolve({ text: next });
    },
  };
}

export const PO_TEXT =
  'Purchase order PO-TST-0001. Amount 12345.67 ZAR. Supplier Lumen Test Supplies (Pty) Ltd.';
export const GRN_TEXT =
  'Goods receipt for PO-TST-0001. Received in full, 12345.67 ZAR, 30 October 2026.';
export const SUPPLIER_TEXT =
  'Lumen Test Supplies (Pty) Ltd. Enrolled payee account FICT-ACC-1001. Status approved.';
export const PAYEE_TEXT =
  'Enrolled payee account FICT-ACC-1001. Bank change requests: none on record.';
export const HISTORY_TEXT =
  'Previous invoices from this supplier were paid on time. No prior holds.';
export const SENDER_TEXT = 'Sender domain matches the enrolled domain.';

export function buyerRecords(verified: VerifiedInvoice): readonly SourceRecord[] {
  const total = verified.total.value?.printed ?? '';
  return [
    { id: 'po', kind: 'PO', provenance: 'PO record PO-TST-0001', text: PO_TEXT },
    { id: 'grn', kind: 'GRN', provenance: 'GRN for PO-TST-0001', text: GRN_TEXT },
    {
      id: 'verified',
      kind: 'VERIFIED_FIELD',
      provenance: 'verified invoice fields',
      text: `Invoice total: ${total} ZAR`,
    },
    { id: 'supplier', kind: 'SUPPLIER_RECORD', provenance: 'supplier master', text: SUPPLIER_TEXT },
    { id: 'payee', kind: 'PAYEE_EVIDENCE', provenance: 'payee record', text: PAYEE_TEXT },
    { id: 'history', kind: 'SUPPLIER_HISTORY', provenance: 'payment history', text: HISTORY_TEXT },
    { id: 'sender', kind: 'SENDER_CHECK', provenance: 'sender check', text: SENDER_TEXT },
    {
      id: 'policy',
      kind: 'POLICY',
      provenance: 'policy-v1',
      text: 'Tolerance for PO variance is zero in this test.',
    },
  ];
}

export const PASS_PROCUREMENT = JSON.stringify({
  schemaVersion: 1,
  verdict: 'PASS',
  reasonCode: 'NONE',
  evidence: [
    { source: 'PO', quote: 'Amount 12345.67 ZAR' },
    { source: 'GRN', quote: 'Received in full, 12345.67 ZAR' },
  ],
});

export const PASS_FRAUD = JSON.stringify({
  schemaVersion: 1,
  verdict: 'PASS',
  reasonCode: 'NONE',
  evidence: [
    { source: 'PAYEE', quote: 'Enrolled payee account FICT-ACC-1001' },
    { source: 'HISTORY', quote: 'No prior holds' },
  ],
});

export const ABSTAIN_PROCUREMENT = JSON.stringify({
  schemaVersion: 1,
  verdict: 'ABSTAIN',
  reasonCode: 'INSUFFICIENT_CONTEXT',
  evidence: [{ source: 'PO', quote: 'Purchase order PO-TST-0001' }],
});

export const HOLD_FRAUD_PAYEE = JSON.stringify({
  schemaVersion: 1,
  verdict: 'HOLD',
  reasonCode: 'PAYEE_MISMATCH',
  evidence: [{ source: 'PAYEE', quote: 'Enrolled payee account FICT-ACC-1001' }],
});

export interface TestDepsOptions {
  readonly checkpoints?: CheckpointStore;
  readonly senderCheck?: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly crashAfterCheckpoints?: number;
  readonly mode?: 'eligibility' | 'payment';
  readonly payments?: PaymentPort;
  readonly facts?: LongTermFacts;
  readonly now?: () => number;
  readonly latencyLimitMs?: number;
  readonly scanned?: boolean;
  readonly nonce?: () => string;
  readonly priorHolds?: number;
}

export function graphDeps(model: ModelClient, options: TestDepsOptions = {}): GraphDeps {
  const base = {
    client: model,
    checkpoints: options.checkpoints ?? new MemoryCheckpointStore(),
    mode: options.mode ?? 'eligibility',
    policyVersion: '2026-11-10.1',
    evidence: register(),
    suppliers: SUPPLIER_LIST,
    alreadyPaid: () => false,
    buyerRecords,
    senderCheck: () => options.senderCheck ?? 'PASS',
    priorHolds: () => options.priorHolds ?? 0,
    poAmountMinor: () => 1_234_567,
    now: options.now ?? (() => 1_000_000),
    nonce: options.nonce ?? (() => '0123456789abcdef01234567'),
  };
  return {
    ...base,
    ...(options.payments === undefined ? {} : { payments: options.payments }),
    ...(options.crashAfterCheckpoints === undefined
      ? {}
      : { crashAfterCheckpoints: options.crashAfterCheckpoints }),
    ...(options.latencyLimitMs === undefined ? {} : { latencyLimitMs: options.latencyLimitMs }),
    ...(options.scanned === undefined ? {} : { scanned: options.scanned }),
  };
}

export function snapshotOf(): PaymentSnapshot {
  return {
    correlationId: 'x',
    supplierId: 'SUP-TST001',
    obligationKey: 'k',
    amountMinor: 1_234_567,
  };
}

export const EMPTY_FACTS = LongTermFacts.empty();

/** A correlation id for tests: a SHA-256 hex string. */
export const CORRELATION = 'b'.repeat(64);
