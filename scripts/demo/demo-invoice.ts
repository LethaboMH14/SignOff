/* eslint-disable security/detect-non-literal-fs-filename -- the paths are inside the local SignOff folder that the launcher and console were given */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256OfBytes } from '../../packages/shared/src/node.js';
import { resolveUsdZarRate } from '../../packages/shared/src/fx/index.js';
import { EvidenceFile } from '../../packages/shared/src/schemas/evidence.js';
import { writeTextPdf } from '../../apps/agent/tools/lib/pdf-writer.js';
import { conversionOf } from '../../apps/agent/src/workflow/fx-convert.js';
import { DEMO_INVOICE } from './prepare.js';

/**
 * Writes one fictional rand invoice into the demo inbox, with its purchase order and goods receipt in the agent's and
 * the Warden's evidence files. The demo launcher and the console's "Send a test invoice" both use it. The agent watches
 * the inbox, and both services re-read their evidence file when it changes, so a new invoice needs no restart.
 */

const SUPPLIER_ID = DEMO_INVOICE.supplierId;

export interface DemoInvoice {
  readonly file: string;
  readonly invoiceNumber: string;
  readonly fingerprint: string;
  readonly usdMinor: number;
  readonly rate: string;
}

/** The run's new invoice: a fictional rand invoice with a unique number, written to the inbox. */
export async function writeDemoInvoice(zarMinor: number, localDir: string): Promise<DemoInvoice> {
  const rate = await resolveUsdZarRate({ mode: 'live' });
  const conversion = conversionOf(zarMinor, rate);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const number = `INV-DEMO-${stamp}`;
  const po = `PO-DEMO-${stamp}`;
  const printedDate = new Date().toISOString().slice(0, 10);
  const totalPrinted = (zarMinor / 100).toFixed(2);
  const bytes = writeTextPdf([
    [
      DEMO_INVOICE.supplierName,
      `Invoice number: ${number}`,
      `Invoice date: ${printedDate}`,
      'Currency: ZAR',
      `Total due: ${totalPrinted}`,
      `PO number: ${po}`,
      `Bank account: ${DEMO_INVOICE.payeeAccountPrinted}`,
      'FICTIONAL TEST INVOICE. NOT A REAL DOCUMENT.',
    ],
  ]);
  const fingerprint = sha256OfBytes(bytes);
  const file = `${number}.pdf`;
  const inbox = join(localDir, 'demo', 'inbox');
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, file), bytes);

  const receivedAt = `${printedDate}T09:00:00.000Z`;
  const agentPath = join(localDir, 'demo', 'evidence-agent.json');
  const agentEvidence = EvidenceFile.parse(JSON.parse(readFileSync(agentPath, 'utf8')) as unknown);
  writeFileSync(
    agentPath,
    `${JSON.stringify(
      EvidenceFile.parse({
        ...agentEvidence,
        invoices: [
          ...agentEvidence.invoices,
          {
            fingerprint,
            supplierId: SUPPLIER_ID,
            invoiceNumber: number,
            currency: 'ZAR',
            amountMinor: zarMinor,
            purchaseOrderId: po,
            payeeAccountAsPrinted: DEMO_INVOICE.payeeAccountPrinted,
          },
        ],
        purchaseOrders: [
          ...agentEvidence.purchaseOrders,
          { purchaseOrderId: po, supplierId: SUPPLIER_ID, currency: 'ZAR', amountMinor: zarMinor },
        ],
        goodsReceipts: [
          ...agentEvidence.goodsReceipts,
          { purchaseOrderId: po, receivedMinor: zarMinor, receivedAt },
        ],
      }),
      null,
      2,
    )}\n`,
  );

  const wardenPath = join(localDir, 'warden', 'evidence.json');
  const wardenEvidence = EvidenceFile.parse(
    JSON.parse(readFileSync(wardenPath, 'utf8')) as unknown,
  );
  writeFileSync(
    wardenPath,
    `${JSON.stringify(
      EvidenceFile.parse({
        ...wardenEvidence,
        invoices: [
          ...wardenEvidence.invoices,
          {
            fingerprint,
            supplierId: SUPPLIER_ID,
            invoiceNumber: number,
            currency: 'USD',
            amountMinor: conversion.amountMinor,
            purchaseOrderId: po,
            payeeAccountAsPrinted: null,
          },
        ],
        purchaseOrders: [
          ...wardenEvidence.purchaseOrders,
          {
            purchaseOrderId: po,
            supplierId: SUPPLIER_ID,
            currency: 'USD',
            amountMinor: conversion.amountMinor,
          },
        ],
        goodsReceipts: [
          ...wardenEvidence.goodsReceipts,
          { purchaseOrderId: po, receivedMinor: conversion.amountMinor, receivedAt },
        ],
      }),
      null,
      2,
    )}\n`,
  );
  return {
    file,
    invoiceNumber: number,
    fingerprint,
    usdMinor: conversion.amountMinor,
    rate: conversion.rate,
  };
}
