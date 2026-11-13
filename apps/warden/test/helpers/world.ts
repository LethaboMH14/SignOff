import { randomBytes, randomUUID } from 'node:crypto';

import { Wallet, type Client } from 'xrpl';

import { obligationKey } from '../../../../packages/shared/src/node.js';
import {
  buildTrustSet,
  configureSigners,
  createXrplPort,
  memoryJournalStore,
  memoryRegistryStore,
  provisionTestnet,
  walletOf,
  type LedgerPort,
  type PaymentDeps,
  type ProvisionDeps,
  type RegistryAccount,
} from '../../../../packages/xrpl/src/index.js';
import { FakeClient, FakeLedger } from '../../../../packages/xrpl/test/helpers/fake-ledger.js';
import type { WardenConfig } from '../../src/config.js';
import { sha256Hex } from '../../src/canonical.js';
import { TEST_TOKEN_CURRENCY } from '../../../../packages/xrpl/src/constants.js';
import { memoryEventLog, type EventLog } from '../../src/events.js';
import { evidenceRegister, type EvidenceFile, type EvidenceRegister } from '../../src/evidence.js';
import { simulatedIdentityChecker } from '../../src/identity.js';
import { WardenService, type WardenDeps } from '../../src/service.js';

/** The supplier and the buyer's invoice numbers used across the Warden tests. */
export const SUPPLIER = 'SUP-ABCD1234';
export const OTHER_SUPPLIER = 'SUP-ZZZZ9999';
export const POLICY_VERSION = '2026-11-10.1';
export const START = new Date('2026-11-10T10:00:00.000Z');

export interface Base {
  readonly ledger: FakeLedger;
  readonly port: LedgerPort;
  readonly registry: ReturnType<typeof memoryRegistryStore>;
  readonly journal: ReturnType<typeof memoryJournalStore>;
  readonly spending: RegistryAccount;
  readonly supplierAccount: RegistryAccount;
  readonly issuer: RegistryAccount;
  readonly agent: RegistryAccount;
  readonly warden: RegistryAccount;
  readonly agentWallet: Wallet;
  readonly wardenWallet: Wallet;
}

/** A ledger with the Warden's accounts provisioned exactly as the Gate A tooling provisions them. */
export async function provisionedBase(): Promise<Base> {
  const ledger = new FakeLedger();
  const port = createXrplPort(
    new FakeClient(ledger) as unknown as Client,
    'wss://s.altnet.rippletest.net:51233',
  );
  const registry = memoryRegistryStore();
  const journal = memoryJournalStore();
  let counter = 0;
  const deps: ProvisionDeps & PaymentDeps = {
    port,
    journal,
    registry,
    now: () => START,
    sleep: () => {
      ledger.advance();
      return Promise.resolve();
    },
    pollMs: 0,
    maxPolls: 60,
    newId: () => {
      counter += 1;
      return `base${String(counter)}`;
    },
    newWallet: () => {
      const wallet = Wallet.generate();
      ledger.expect(wallet);
      return wallet;
    },
    log: () => undefined,
    maxAttempts: 3,
  };
  await provisionTestnet(deps);
  await configureSigners(deps);
  const current = registry.current();
  if (current === null) {
    throw new Error('provisioning did not write the registry');
  }
  const find = (role: RegistryAccount['role']): RegistryAccount => {
    const found = current.accounts.find(
      (account) => account.role === role && account.status !== 'abandoned',
    );
    if (found === undefined) {
      throw new Error(`no ${role} account`);
    }
    return found;
  };
  const agent = find('agent');
  const warden = find('warden');
  const wardenSeed = warden.seed;
  if (wardenSeed === undefined) {
    throw new Error('the warden account has no seed in the test registry');
  }
  return {
    ledger,
    port,
    registry,
    journal,
    spending: find('spending'),
    supplierAccount: find('supplier'),
    issuer: find('issuer'),
    agent,
    warden,
    agentWallet: walletOf(agent),
    wardenWallet: Wallet.fromSeed(wardenSeed),
  };
}

/** The Warden's configuration for the test world. The asset is the test token, paid as the expected asset. */
export function configFor(base: Base, overrides: Partial<WardenConfig> = {}): WardenConfig {
  return {
    buyerScope: 'buyer-test',
    policyVersion: POLICY_VERSION,
    expectedAsset: { currency: 'USD', ledgerCurrency: 'TST', issuer: base.issuer.address },
    alternateAssets: [],
    spendingAddress: base.spending.address,
    agentAddress: base.agent.address,
    wardenAddress: base.warden.address,
    coolingOffMs: 24 * 60 * 60 * 1000,
    matchTolerance: { absoluteMinor: 100, basisPoints: 100 },
    initialLimits: {
      perPaymentMinor: 100_000,
      supplierDailyMinor: 500_000,
      dailyTotalMinor: 1_000_000,
    },
    submission: { pollMs: 0, maxPolls: 60 },
    listen: { host: '127.0.0.1', port: 0 },
    verifiedPayees: [base.supplierAccount.address],
    supplierDomain: null,
    ...overrides,
  };
}

/**
 * A fresh account on the test ledger that can hold the test token, for use as a changed payee. It is funded and
 * has a trust line, so the pre-signing check treats it like any enrolled supplier.
 */
export async function fundedPayee(base: Base): Promise<string> {
  const wallet = Wallet.generate();
  base.ledger.fund(wallet);
  const trust = buildTrustSet(wallet.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer: base.issuer.address,
    value: '1000000',
  });
  const prepared = await base.port.autofill(trust, 0);
  await base.port.submit(wallet.sign(prepared).tx_blob);
  base.ledger.advance();
  return wallet.address;
}

/** A clock the tests can move forward. */
export interface Clock {
  now: Date;
}

export function newClock(): Clock {
  return { now: new Date(START.getTime()) };
}

/** The dependencies the service needs, over a shared ledger, log and clock. */
export function wardenDeps(
  base: Base,
  config: WardenConfig,
  evidence: EvidenceRegister,
  options: { readonly clock?: Clock; readonly log?: EventLog; readonly port?: LedgerPort } = {},
): WardenDeps {
  const clock = options.clock ?? newClock();
  return {
    config,
    wardenWallet: base.wardenWallet,
    log: options.log ?? memoryEventLog(),
    journal: base.journal,
    port: options.port ?? base.port,
    evidence,
    identity: simulatedIdentityChecker(new Set(config.verifiedPayees)),
    now: () => clock.now,
    sleep: () => {
      base.ledger.advance();
      return Promise.resolve();
    },
    newId: () => randomUUID(),
  };
}

export async function openService(
  base: Base,
  config: WardenConfig,
  evidence: EvidenceRegister,
  options: { readonly clock?: Clock; readonly log?: EventLog; readonly port?: LedgerPort } = {},
): Promise<WardenService> {
  return WardenService.open(wardenDeps(base, config, evidence, options));
}

export interface InvoiceEntry {
  readonly invoiceNumber: string;
  readonly fingerprint: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'ZAR' | 'EUR';
  readonly purchaseOrderId: string | null;
  readonly printedPayee: string | null;
  readonly order: { readonly amountMinor: number; readonly supplierId: string } | null;
  readonly receivedMinor: number | null;
}

/** A complete, matching entry: invoice, order and receipt agree. Tests change one field at a time. */
export function entry(
  overrides: Partial<InvoiceEntry> & {
    readonly invoiceNumber: string;
    readonly fingerprint: string;
  },
): InvoiceEntry {
  return {
    amountMinor: 1000,
    currency: 'USD',
    purchaseOrderId: `PO-${overrides.invoiceNumber}`,
    printedPayee: null,
    order: { amountMinor: 1000, supplierId: SUPPLIER },
    receivedMinor: 1000,
    ...overrides,
  };
}

export function evidenceFrom(entries: readonly InvoiceEntry[]): EvidenceRegister {
  const file: EvidenceFile = {
    schemaVersion: 1,
    invoices: entries.map((item) => ({
      fingerprint: item.fingerprint,
      supplierId: SUPPLIER,
      invoiceNumber: item.invoiceNumber,
      currency: item.currency,
      amountMinor: item.amountMinor,
      purchaseOrderId: item.purchaseOrderId,
      payeeAccountAsPrinted: item.printedPayee,
    })),
    purchaseOrders: entries.flatMap((item) =>
      item.purchaseOrderId === null || item.order === null
        ? []
        : [
            {
              purchaseOrderId: item.purchaseOrderId,
              supplierId: item.order.supplierId,
              currency: item.currency,
              amountMinor: item.order.amountMinor,
            },
          ],
    ),
    goodsReceipts: entries.flatMap((item) =>
      item.purchaseOrderId === null || item.receivedMinor === null
        ? []
        : [
            {
              purchaseOrderId: item.purchaseOrderId,
              receivedMinor: item.receivedMinor,
              receivedAt: START.toISOString(),
            },
          ],
    ),
  };
  return evidenceRegister(file);
}

/** A standard payable: one invoice, matched to its order and receipt. */
export const STANDARD = entry({ invoiceNumber: 'INV-001', fingerprint: sha256Hex('invoice-001') });

/** A proposal from the agent for an entry, built the way the agent builds it. */
export function proposalFor(
  attemptId: string,
  item: InvoiceEntry,
  config: WardenConfig,
  now: Date,
  supplierId = SUPPLIER,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    obligationKey: obligationKey(supplierId, item.invoiceNumber),
    attemptId,
    supplierId,
    currency: item.currency,
    amountMinor: item.amountMinor,
    invoiceFingerprint: item.fingerprint,
    policyVersion: config.policyVersion,
    proposedBy: 'agent',
    proposedAt: now.toISOString(),
  };
}

export function newAttemptId(): string {
  return randomUUID();
}

/** A fresh request secret, long enough for the keys file. */
export function newSecret(): Buffer {
  return randomBytes(32);
}
