import { evidenceRegister } from '../../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../../packages/shared/src/schemas/evidence.js';
import type { PaymentProposal } from '../../../../packages/shared/src/schemas/proposal.js';
import type { CoSignResult, ProposeResult } from '../../../../packages/warden-api/src/contract.js';
import type { IntakeOutcome } from '../../src/intake/intake.js';
import type { ModelClient, ModelRequest } from '../../src/model/types.js';
import { parseSupplierMaster, type SupplierMaster } from '../../src/match/supplier-master.js';
import type { PipelineDeps, AgentSigner } from '../../src/workflow/pipeline.js';
import { conversionOf } from '../../src/workflow/fx-convert.js';
import { fixtureUsdZarRate } from '../../../../packages/shared/src/fx/index.js';
import type { WardenPort } from '../../src/workflow/warden-port.js';
import { TransitionLog } from '../../src/log/transition-log.js';

/**
 * A small, fictional world for the workflow tests: one supplier, one invoice, one purchase order and one receipt that
 * agree with each other. Each test changes one thing to show what the workflow does about it.
 */

export const FP = 'a'.repeat(64);
export const ATTEMPT = '11111111-2222-4333-8444-555555555555';
export const POLICY = '2026-11-10.1';
export const HASH = 'C'.repeat(64);

export const INVOICE_LINES = [
  'Lumen Test Supplies (Pty) Ltd',
  'Invoice number: INV-TST-0100',
  'Invoice date: 05/11/2026',
  'Currency: ZAR',
  'Total due: 12345.67',
  'PO number: PO-TST-0001',
  'Bank account: FICT-ACC-1001',
];

export const PAGES: readonly string[] = [INVOICE_LINES.join('\n')];

export const GOOD_REPLY = JSON.stringify({
  schemaVersion: 1,
  supplierName: { value: 'Lumen Test Supplies (Pty) Ltd', quote: 'Lumen Test Supplies (Pty) Ltd' },
  invoiceNumber: { value: 'INV-TST-0100', quote: 'Invoice number: INV-TST-0100' },
  invoiceDate: { value: '2026-11-05', quote: 'Invoice date: 05/11/2026' },
  currency: { value: 'ZAR', quote: 'Currency: ZAR' },
  totalAsPrinted: { value: '12345.67', quote: 'Total due: 12345.67' },
  purchaseOrderNumber: { value: 'PO-TST-0001', quote: 'PO number: PO-TST-0001' },
  payeeAccountAsPrinted: { value: 'FICT-ACC-1001', quote: 'Bank account: FICT-ACC-1001' },
});

export function evidenceFile(
  overrides: Partial<{ amountMinor: number; receivedMinor: number }> = {},
) {
  const amount = overrides.amountMinor ?? 1_234_567;
  return EvidenceFile.parse({
    schemaVersion: 1,
    invoices: [
      {
        fingerprint: FP,
        supplierId: 'SUP-TST001',
        invoiceNumber: 'INV-TST-0100',
        currency: 'ZAR',
        amountMinor: amount,
        purchaseOrderId: 'PO-TST-0001',
        payeeAccountAsPrinted: 'FICT-ACC-1001',
      },
    ],
    purchaseOrders: [
      {
        purchaseOrderId: 'PO-TST-0001',
        supplierId: 'SUP-TST001',
        currency: 'ZAR',
        amountMinor: 1_234_567,
      },
    ],
    goodsReceipts: [
      {
        purchaseOrderId: 'PO-TST-0001',
        receivedMinor: overrides.receivedMinor ?? 1_234_567,
        receivedAt: '2026-10-30T09:00:00.000Z',
      },
    ],
  });
}

export function register(overrides: Partial<{ amountMinor: number; receivedMinor: number }> = {}) {
  return evidenceRegister(evidenceFile(overrides));
}

export const SUPPLIER_LIST: readonly SupplierMaster[] = parseSupplierMaster({
  schemaVersion: 1,
  suppliers: [
    {
      supplierId: 'SUP-TST001',
      legalName: 'Lumen Test Supplies (Pty) Ltd',
      enrolledPayeeAsPrinted: 'FICT-ACC-1001',
      status: 'approved',
    },
  ],
});

export function intakeOk(pages: readonly string[] = PAGES): IntakeOutcome {
  return { kind: 'text-pdf', fingerprint: FP, bytes: 1024, pages };
}

export interface Canned extends ModelClient {
  readonly requests: ModelRequest[];
}

/** A model that gives the scripted replies in order. A thrown Error stands for a failed call. */
export function cannedModel(replies: readonly (string | Error)[]): Canned {
  const queue = [...replies];
  const requests: ModelRequest[] = [];
  return {
    label: 'test:canned',
    requests,
    complete(request: ModelRequest) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) {
        return Promise.reject(new Error('no reply scripted'));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve({ text: next });
    },
  };
}

export interface FakeWarden extends WardenPort {
  readonly proposals: PaymentProposal[];
  readonly cosigned: { attemptId: string; blob: string }[];
}

export interface WardenScript {
  readonly propose?: (proposal: PaymentProposal) => Promise<ProposeResult>;
  readonly coSign?: (attemptId: string, blob: string) => Promise<CoSignResult>;
}

/** A Warden that allows by default and pays by default. Each test replaces the answer it needs to change. */
export function fakeWarden(script: WardenScript = {}): FakeWarden {
  const proposals: PaymentProposal[] = [];
  const cosigned: { attemptId: string; blob: string }[] = [];
  return {
    proposals,
    cosigned,
    propose(proposal) {
      proposals.push(proposal);
      if (script.propose !== undefined) {
        return script.propose(proposal);
      }
      return Promise.resolve({
        attemptId: proposal.attemptId,
        decision: {
          schemaVersion: 1,
          proposalFingerprint: 'b'.repeat(64),
          policyVersion: POLICY,
          evaluatedAt: '2026-11-10T10:00:00.000Z',
          decision: 'ALLOW',
          reasons: [],
        },
        toCoSign: 'ABCDEF0123',
      });
    },
    coSign(attemptId, blob) {
      cosigned.push({ attemptId, blob });
      if (script.coSign !== undefined) {
        return script.coSign(attemptId, blob);
      }
      return Promise.resolve({
        attemptId,
        outcome: 'paid',
        hash: HASH,
        ledgerIndex: 1000,
        engineResult: 'tesSUCCESS',
      });
    },
  };
}

export const SIGNER: AgentSigner = {
  coSign: (toCoSign) => `${toCoSign}+agent`,
};

export function depsWith(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    model: cannedModel([GOOD_REPLY]),
    evidence: register(),
    suppliers: SUPPLIER_LIST,
    log: TransitionLog.open(null, () => new Date('2026-11-10T10:00:00.000Z')),
    policyVersion: POLICY,
    now: () => new Date('2026-11-10T10:00:00.000Z'),
    newAttemptId: () => ATTEMPT,
    nonce: () => 'a1b2c3d4e5f60718293a4b5c',
    warden: fakeWarden(),
    signer: SIGNER,
    // The committed fixture rate, so tests never call the network.
    convert: (zarMinor) => Promise.resolve(conversionOf(zarMinor, fixtureUsdZarRate())),
    ...overrides,
  };
}
