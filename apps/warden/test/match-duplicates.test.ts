import { describe, expect, it } from 'vitest';

import { evidenceRegister } from '../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../packages/shared/src/schemas/evidence.js';
import { parseSupplierMaster } from '../../agent/src/match/supplier-master.js';
import { matchInvoice } from '../../agent/src/match/match.js';
import { matchVerdict } from '../src/checks.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { sha256Hex } from '../src/canonical.js';
import type { WardenService } from '../src/service.js';
import {
  configFor,
  entry,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  proposalFor,
  provisionedBase,
  STANDARD,
  SUPPLIER,
  type Base,
  type Clock,
  type InvoiceEntry,
} from './helpers/world.js';

/**
 * Two things the matching lane must prove on the Warden side. First, a re-saved invoice (different bytes, same supplier
 * and number) or a revised one is held as a duplicate of the payable. Second, the receipt and order tolerance gives the
 * same verdict here and in the agent, on the same input (the shared rule in packages/shared/src/match-rules.ts).
 */

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';

async function activeSupplier(
  service: WardenService,
  base: Base,
  publicKey: string,
): Promise<void> {
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: base.supplierAccount.address, destinationTag: null },
      publicKey,
    },
    OPERATOR_A,
  );
  await service.approveSupplier(SUPPLIER, OPERATOR_B);
}

async function payEntry(
  service: WardenService,
  base: Base,
  config: ReturnType<typeof configFor>,
  item: InvoiceEntry,
  clock: Clock,
) {
  const attemptId = newAttemptId();
  const reply = await service.propose(proposalFor(attemptId, item, config, clock.now));
  if (reply.toCoSign === null) throw new Error('the first payment must be allowed');
  const outcome = await service.coSign(attemptId, coSignAsAgent(base.agentWallet, reply.toCoSign));
  return outcome;
}

describe('a re-saved or revised invoice is a duplicate of its payable', () => {
  const RESAVED = entry({
    invoiceNumber: 'INV-001',
    fingerprint: sha256Hex('invoice-001-re-saved'),
    purchaseOrderId: 'PO-RESAVED',
  });
  const REVISED = entry({
    invoiceNumber: 'INV-001',
    fingerprint: sha256Hex('invoice-001-revised'),
    purchaseOrderId: 'PO-REVISED',
    amountMinor: 1_200,
    order: { amountMinor: 1_200, supplierId: SUPPLIER },
    receivedMinor: 1_200,
  });

  it('holds a re-saved file with the same number once the original has been paid', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD, RESAVED]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const paid = await payEntry(service, base, config, STANDARD, clock);
    expect(paid.outcome).toBe('paid');
    const again = await service.propose(proposalFor(newAttemptId(), RESAVED, config, clock.now));
    expect(again.decision).toMatchObject({ decision: 'HOLD', reasons: [{ code: 'DUPLICATE' }] });
  });

  it('holds a re-saved file while the original is reserved and not yet settled', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD, RESAVED]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const first = await service.propose(proposalFor(newAttemptId(), STANDARD, config, clock.now));
    expect(first.decision.decision).toBe('ALLOW');
    const second = await service.propose(proposalFor(newAttemptId(), RESAVED, config, clock.now));
    expect(second.decision).toMatchObject({ decision: 'HOLD', reasons: [{ code: 'DUPLICATE' }] });
  });

  it('holds a revised invoice with the same number and a different amount once the original is paid', async () => {
    const base = await provisionedBase();
    const config = configFor(base);
    const clock = newClock();
    const service = await openService(base, config, evidenceFrom([STANDARD, REVISED]), { clock });
    await activeSupplier(service, base, generateSupplierKey().publicKey);
    const paid = await payEntry(service, base, config, STANDARD, clock);
    expect(paid.outcome).toBe('paid');
    const revised = await service.propose(proposalFor(newAttemptId(), REVISED, config, clock.now));
    expect(revised.decision).toMatchObject({ decision: 'HOLD', reasons: [{ code: 'DUPLICATE' }] });
  });
});

const PARITY_SUPPLIER = 'SUP-PAR00001';
const AMOUNT_CODES = ['AMOUNT_EXCEEDS_ORDER', 'AMOUNT_MISMATCH', 'AMOUNT_EXCEEDS_RECEIPT'];
const TOLERANCE = { absoluteMinor: 100, basisPoints: 100 };

/** Order, invoice and receipt, in minor units, with the expected hold (true) or pass (false). */
const PARITY_CASES: readonly (readonly [number, number, number, boolean])[] = [
  [1_000, 1_000, 1_000, false],
  [1_000_000, 1_010_000, 1_010_000, false],
  [1_000_000, 1_010_001, 1_010_001, true],
  [1_000_000, 990_000, 990_000, false],
  [1_000_000, 989_999, 989_999, true],
  [1_000_000, 1_000_000, 990_000, false],
  [1_000_000, 1_000_000, 989_999, true],
  [100, 201, 201, true],
  [20_000, 20_200, 20_200, false],
  [20_000, 20_201, 20_201, true],
  [5_000_000, 5_000_000, 4_950_000, false],
  [5_000_000, 5_000_000, 4_949_999, true],
];

describe('the tolerance rule gives one verdict in the agent and in the Warden', () => {
  it.each(PARITY_CASES)(
    'order %i, invoice %i, received %i: the hold is %s on both sides',
    (orderMinor, invoiceMinor, receivedMinor, expectHold) => {
      const invoiceFingerprint = sha256Hex(`parity-${String(orderMinor)}-${String(invoiceMinor)}`);
      const wardenVerdict = matchVerdict({
        supplierId: PARITY_SUPPLIER,
        invoice: {
          fingerprint: invoiceFingerprint,
          supplierId: PARITY_SUPPLIER,
          invoiceNumber: 'INV-P',
          currency: 'USD',
          amountMinor: invoiceMinor,
          purchaseOrderId: 'PO-P',
          payeeAccountAsPrinted: null,
        },
        purchaseOrder: {
          purchaseOrderId: 'PO-P',
          supplierId: PARITY_SUPPLIER,
          currency: 'USD',
          amountMinor: orderMinor,
        },
        receipt: { purchaseOrderId: 'PO-P', receivedMinor, receivedAt: '2026-11-10T10:00:00.000Z' },
        tolerance: TOLERANCE,
      });

      const file = EvidenceFile.parse({
        schemaVersion: 1,
        invoices: [
          {
            fingerprint: invoiceFingerprint,
            supplierId: PARITY_SUPPLIER,
            invoiceNumber: 'INV-P',
            currency: 'USD',
            amountMinor: invoiceMinor,
            purchaseOrderId: 'PO-P',
            payeeAccountAsPrinted: null,
          },
        ],
        purchaseOrders: [
          {
            purchaseOrderId: 'PO-P',
            supplierId: PARITY_SUPPLIER,
            currency: 'USD',
            amountMinor: orderMinor,
          },
        ],
        goodsReceipts: [
          { purchaseOrderId: 'PO-P', receivedMinor, receivedAt: '2026-11-10T10:00:00.000Z' },
        ],
      });
      const agent = matchInvoice({
        values: {
          supplierName: 'Parity Supplies',
          invoiceNumber: 'INV-P',
          currency: 'USD',
          totalMinor: invoiceMinor,
          purchaseOrderNumber: 'PO-P',
          payeeAccountAsPrinted: null,
        },
        fingerprint: invoiceFingerprint,
        evidence: evidenceRegister(file),
        suppliers: parseSupplierMaster({
          schemaVersion: 1,
          suppliers: [
            {
              supplierId: PARITY_SUPPLIER,
              legalName: 'Parity Supplies',
              enrolledPayeeAsPrinted: null,
              status: 'approved',
            },
          ],
        }),
        alreadyPaid: () => false,
        tolerance: TOLERANCE,
      });

      const agentAmountHold =
        !agent.ok && agent.reasons.some((code) => AMOUNT_CODES.includes(code));
      expect(wardenVerdict !== null).toBe(expectHold);
      expect(agentAmountHold).toBe(expectHold);
    },
  );
});
