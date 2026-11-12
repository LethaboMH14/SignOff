/* eslint-disable security/detect-non-literal-fs-filename -- the operator-named paths are inside the local SignOff folder, checked by assertOutsideRepository */
// Prepares the RLUSD demo: one fictional rand invoice, the buyer records the agent and the Warden check against,
// the Warden's configuration and keys, and the agent's identity. Nothing here is a payment; it only writes files.
//
// Usage: npm run demo:prepare            (writes once; refuses to overwrite an existing Warden directory)
//
// Outside the repository (private, never printed): %LOCALAPPDATA%\SignOff\testnet\warden\ (Warden config, keys,
// callers, buyer evidence in USD) and %LOCALAPPDATA%\SignOff\testnet\demo\ (identities, agent state, inbox).
// Inside the repository (fictional, committed): scripts/demo/fixtures/ (the invoice PDF, the agent's buyer
// evidence and supplier master). The Warden's USD record uses the live USD/ZAR rate read now, so it is local.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { sha256OfBytes } from '../../packages/shared/src/node.js';
import { resolveUsdZarRate } from '../../packages/shared/src/fx/index.js';
import { EvidenceFile } from '../../packages/shared/src/schemas/evidence.js';
import { writeTextPdf } from '../../apps/agent/tools/lib/pdf-writer.js';
import { AGENT_POLICY_VERSION } from '../../apps/agent/src/config.js';
import { conversionOf } from '../../apps/agent/src/workflow/fx-convert.js';
import { WardenConfigFile } from '../../apps/warden/src/config.js';
import { requireAccount, RLUSD_TESTNET } from '../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileRegistryStore,
} from '../../packages/xrpl/src/node.js';

/**
 * The Warden's policy version must equal the one the agent declares on every proposal. The second live attempt was
 * held by the Warden with INVARIANT_FAILED because the demo used a different version (demo-attempt-2 folder).
 */
export const DEMO_POLICY_VERSION = AGENT_POLICY_VERSION;
export const DEMO_LISTEN = { host: '127.0.0.1', port: 8789 } as const;
/** Demo limits in USD minor units (cents). The spending account holds about USD 2.78 of RLUSD, so these cap every payment. */
export const DEMO_LIMITS = {
  perPaymentMinor: 500,
  supplierDailyMinor: 500,
  dailyTotalMinor: 500,
} as const;

/** The demo invoice: R20.00, fictional, supplier SUP-TST001 (the labelled set's first supplier). */
export const DEMO_INVOICE = {
  file: 'demo-zar-20.pdf',
  supplierId: 'SUP-TST001',
  supplierName: 'Lumen Test Supplies (Pty) Ltd',
  payeeAccountPrinted: 'FICT-ACC-1001',
  invoiceNumber: 'INV-DEMO-0001',
  // ISO on the page: the first live run printed 12/11/2026 and the model abstained on the date (demo-attempt-1 log).
  printedDate: '2026-11-12',
  isoDate: '2026-11-12',
  totalMinor: 2000,
  totalPrinted: '20.00',
  purchaseOrderId: 'PO-DEMO-0001',
} as const;

const IDENTITIES = z.strictObject({
  schemaVersion: z.literal(1),
  agentId: z.string().min(1),
  /** Hex, because the agent reads SIGNOFF_AGENT_SECRET as hex. The Warden keys file holds the same bytes in base64. */
  agentSecretHex: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Identities = z.infer<typeof IDENTITIES>;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
export const FIXTURES = join(here, 'fixtures');

/** Writes the invoice PDF and the committed fixtures. Returns the PDF bytes' fingerprint. */
export function writeCommittedFixtures(): string {
  mkdirSync(join(FIXTURES, 'invoices'), { recursive: true });
  const lines = [
    DEMO_INVOICE.supplierName,
    `Invoice number: ${DEMO_INVOICE.invoiceNumber}`,
    `Invoice date: ${DEMO_INVOICE.printedDate}`,
    'Currency: ZAR',
    `Total due: ${DEMO_INVOICE.totalPrinted}`,
    `PO number: ${DEMO_INVOICE.purchaseOrderId}`,
    `Bank account: ${DEMO_INVOICE.payeeAccountPrinted}`,
    'FICTIONAL TEST INVOICE. NOT A REAL DOCUMENT.',
  ];
  const bytes = writeTextPdf([lines]);
  writeFileSync(join(FIXTURES, 'invoices', DEMO_INVOICE.file), bytes);
  const fingerprint = sha256OfBytes(bytes);
  const receivedAt = `${DEMO_INVOICE.isoDate}T09:00:00.000Z`;
  const agentEvidence = EvidenceFile.parse({
    schemaVersion: 1,
    invoices: [
      {
        fingerprint,
        supplierId: DEMO_INVOICE.supplierId,
        invoiceNumber: DEMO_INVOICE.invoiceNumber,
        currency: 'ZAR',
        amountMinor: DEMO_INVOICE.totalMinor,
        purchaseOrderId: DEMO_INVOICE.purchaseOrderId,
        payeeAccountAsPrinted: DEMO_INVOICE.payeeAccountPrinted,
      },
    ],
    purchaseOrders: [
      {
        purchaseOrderId: DEMO_INVOICE.purchaseOrderId,
        supplierId: DEMO_INVOICE.supplierId,
        currency: 'ZAR',
        amountMinor: DEMO_INVOICE.totalMinor,
      },
    ],
    goodsReceipts: [
      {
        purchaseOrderId: DEMO_INVOICE.purchaseOrderId,
        receivedMinor: DEMO_INVOICE.totalMinor,
        receivedAt,
      },
    ],
  });
  writeFileSync(
    join(FIXTURES, 'evidence-agent.json'),
    `${JSON.stringify(agentEvidence, null, 2)}\n`,
  );
  writeFileSync(
    join(FIXTURES, 'suppliers.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suppliers: [
          {
            supplierId: DEMO_INVOICE.supplierId,
            legalName: DEMO_INVOICE.supplierName,
            enrolledPayeeAsPrinted: DEMO_INVOICE.payeeAccountPrinted,
            status: 'approved',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return fingerprint;
}

async function main(): Promise<void> {
  const localDir = defaultLocalDir();
  assertOutsideRepository(localDir, repoRoot);
  const wardenDir = join(localDir, 'warden');
  const demoDir = join(localDir, 'demo');
  if (existsSync(join(wardenDir, 'warden-keys.json'))) {
    throw new Error(
      'the demo is already prepared; to start over, stop any Warden and remove the warden and demo folders under the local directory',
    );
  }
  const registry = await fileRegistryStore(join(localDir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run npm run testnet:provision first');
  }
  const spending = requireAccount(registry, 'spending');
  const supplier = requireAccount(registry, 'supplier');
  const agent = requireAccount(registry, 'agent');
  const warden = requireAccount(registry, 'warden');
  if (warden.seed === undefined) {
    throw new Error('the registry holds no Warden seed');
  }

  // The rate is read live. A fixture fallback is refused: a payment must never use a stale default.
  const rate = await resolveUsdZarRate({ mode: 'live' });
  const conversion = conversionOf(DEMO_INVOICE.totalMinor, rate);

  const fingerprint = writeCommittedFixtures();

  mkdirSync(wardenDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(demoDir, 'inbox'), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32);
  const identities: Identities = IDENTITIES.parse({
    schemaVersion: 1,
    agentId: 'agent-demo',
    agentSecretHex: secret.toString('hex'),
  });
  const operatorA = randomBytes(32).toString('base64');
  const operatorB = randomBytes(32).toString('base64');

  const config = WardenConfigFile.parse({
    schemaVersion: 1,
    buyerScope: 'buyer-demo-testnet',
    policyVersion: DEMO_POLICY_VERSION,
    expectedAsset: {
      currency: 'USD',
      ledgerCurrency: RLUSD_TESTNET.currency,
      issuer: RLUSD_TESTNET.issuer,
    },
    alternateAssets: [],
    spendingAddress: spending.address,
    agentAddress: agent.address,
    wardenAddress: warden.address,
    // Demo only: a real cooling-off period is in days (FX-AND-CALENDAR.md). It is set to zero so the demo can run.
    coolingOffHours: 0,
    matchTolerance: { absoluteMinor: 100, basisPoints: 100 },
    limits: DEMO_LIMITS,
    submission: { pollMs: 2000, maxPolls: 120 },
    listen: DEMO_LISTEN,
    verifiedPayees: [supplier.address],
  });
  const usdRecord = {
    fingerprint,
    supplierId: DEMO_INVOICE.supplierId,
    invoiceNumber: DEMO_INVOICE.invoiceNumber,
    currency: 'USD',
    amountMinor: conversion.amountMinor,
    purchaseOrderId: DEMO_INVOICE.purchaseOrderId,
    payeeAccountAsPrinted: null,
  };
  const wardenEvidence = EvidenceFile.parse({
    schemaVersion: 1,
    invoices: [usdRecord],
    purchaseOrders: [
      {
        purchaseOrderId: DEMO_INVOICE.purchaseOrderId,
        supplierId: DEMO_INVOICE.supplierId,
        currency: 'USD',
        amountMinor: conversion.amountMinor,
      },
    ],
    goodsReceipts: [
      {
        purchaseOrderId: DEMO_INVOICE.purchaseOrderId,
        receivedMinor: conversion.amountMinor,
        receivedAt: `${DEMO_INVOICE.isoDate}T09:00:00.000Z`,
      },
    ],
  });
  const keys = {
    schemaVersion: 1,
    wardenSeed: warden.seed,
    principals: [
      { id: identities.agentId, role: 'agent', secret: secret.toString('base64') },
      { id: 'operator-a', role: 'operator', secret: operatorA },
      { id: 'operator-b', role: 'operator', secret: operatorB },
    ],
  };
  const write = (path: string, value: unknown): void => {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  };
  write(join(wardenDir, 'warden-config.json'), config);
  write(join(wardenDir, 'warden-keys.json'), keys);
  write(join(wardenDir, 'evidence.json'), wardenEvidence);
  write(join(wardenDir, 'warden-callers.json'), { schemaVersion: 1, principals: keys.principals });
  write(join(demoDir, 'identities.json'), identities);
  copyFileSync(join(FIXTURES, 'evidence-agent.json'), join(demoDir, 'evidence-agent.json'));
  copyFileSync(join(FIXTURES, 'suppliers.json'), join(demoDir, 'suppliers.json'));

  process.stdout.write(
    `${JSON.stringify(
      {
        prepared: { warden: 'warden folder', demo: 'demo folder' },
        invoice: { file: DEMO_INVOICE.file, zarMinor: DEMO_INVOICE.totalMinor, fingerprint },
        conversion: {
          usdMinor: conversion.amountMinor,
          rate: conversion.rate,
          rateDate: conversion.rateDate,
          source: conversion.source,
        },
        policyVersion: DEMO_POLICY_VERSION,
        limitsUsdMinor: DEMO_LIMITS,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown failure';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
