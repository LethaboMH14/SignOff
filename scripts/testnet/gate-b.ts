/* eslint-disable security/detect-non-literal-fs-filename -- paths are under the operator's private local directory, checked by assertOutsideRepository */
// Gate B live evidence on the XRP Ledger Testnet. Testnet only: the ledger adapter checks each endpoint against
// its allow-list, and the registry, the Warden's files and their lock live outside the repository. Output holds
// decisions, result codes, counts and transaction hashes only: no addresses and no seeds.
//
// Usage: npm run testnet:gate-b -- <prepare|health|b1|b8|p0-stop>
//   prepare  writes the Warden's configuration, keys, evidence and the callers' secrets into the Warden's private
//            directory. It refuses when that directory already has an event log, so a run always starts fresh.
//   health   reads the Warden's health route.
//   b1       the payment controls (B1 to B7) against the Warden process already running (npm run warden:serve).
//   b8       the frozen trust line: the issuer freezes the spending line, the Warden holds, the issuer unfreezes
//            the line, and the Warden pays.
//   p0-stop  fresh-directory Testnet regression: an Agent-only blob is rejected by ledger quorum; after
//            operator pause the Warden refuses to finalize the captured proposal. Never pays.
//
// The Warden is a separate process. This command talks to it over HTTP, as the agent and the operators do, and
// it only ever holds the callers' own secrets. The test-issued token (TST) stands in for RLUSD, which is unfunded
// (TEST-LOG T-059); every row says so.

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode, type SubmittableTransaction, type TrustSet, type Wallet } from 'xrpl';
import { z } from 'zod';

import { sha256Hex } from '../../apps/warden/src/canonical.js';
import {
  ClientError,
  coSignAsAgent,
  generateSupplierKey,
  WardenClient,
} from '../../apps/warden/src/client.js';
import { WardenConfigFile } from '../../apps/warden/src/config.js';
import { EvidenceFile } from '../../apps/warden/src/evidence.js';
import { obligationKey } from '../../packages/shared/src/node.js';
import { minorToDecimal } from '../../packages/shared/src/money/minor-units.js';
import { compareDecimal } from '../../packages/xrpl/src/amounts.js';
import { TEST_TOKEN_CURRENCY } from '../../packages/xrpl/src/constants.js';
import {
  connectTestnetPort,
  signAsSigner,
  testnetEndpoints,
  type LedgerPort,
} from '../../packages/xrpl/src/index.js';
import type { LedgerLookup } from '../../packages/xrpl/src/reconcile.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileRegistryStore,
} from '../../packages/xrpl/src/node.js';
import { requireAccount, walletOf } from '../../packages/xrpl/src/provision.js';
import type { Registry, RegistryAccount } from '../../packages/xrpl/src/registry.js';

/** The buyer's supplier, the policy and the Warden's listening port for this run. */
const SUPPLIER_ID = 'SUP-GATEB001';
const POLICY_VERSION = '2026-11-10.1';
const LISTEN = { host: '127.0.0.1', port: 8788 } as const;
const HIGH_LIMIT_MINOR = 50_000;
const TF_SET_FREEZE = 0x00100000;
const TF_CLEAR_FREEZE = 0x00200000;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const localDir = defaultLocalDir();
const wardenDir = join(localDir, 'warden');

const CallersFile = z.strictObject({
  schemaVersion: z.literal(1),
  principals: z.array(
    z.strictObject({
      id: z.string().min(1).max(64),
      role: z.enum(['agent', 'operator']),
      secret: z.string().min(40).max(200),
    }),
  ),
});
type CallersFile = z.infer<typeof CallersFile>;

interface Invoice {
  readonly label: string;
  readonly amountMinor: number;
  /** True when the invoice prints an account other than the enrolled payee. */
  readonly otherPayee: boolean;
  /** True when a goods receipt exists for the purchase order. */
  readonly receipt: boolean;
}

/** One invoice per control, so each result is independent of the others. */
const INVOICES: readonly Invoice[] = [
  { label: 'GB-B1-001', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B2-001', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B3-001', amountMinor: 1000, otherPayee: true, receipt: true },
  { label: 'GB-B4-001', amountMinor: 1000, otherPayee: false, receipt: false },
  { label: 'GB-B5-001', amountMinor: 60_000, otherPayee: false, receipt: true },
  { label: 'GB-B5-002', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B5-003', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B6-001', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B7-001', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B7-002', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-B8-001', amountMinor: 1000, otherPayee: false, receipt: true },
  { label: 'GB-P0-001', amountMinor: 1000, otherPayee: false, receipt: true },
];

interface Roster {
  readonly spending: RegistryAccount;
  readonly supplier: RegistryAccount;
  readonly issuer: RegistryAccount;
  readonly agent: RegistryAccount;
  readonly warden: RegistryAccount;
}

interface Row {
  readonly step: string;
  readonly expected: string;
  readonly actual: string;
  readonly result: 'PASS' | 'FAIL';
  readonly hash?: string;
}

function fingerprintOf(label: string): string {
  return sha256Hex(`gate-b|${label}`);
}

function rosterOf(registry: Registry): Roster {
  return {
    spending: requireAccount(registry, 'spending'),
    supplier: requireAccount(registry, 'supplier'),
    issuer: requireAccount(registry, 'issuer'),
    agent: requireAccount(registry, 'agent'),
    warden: requireAccount(registry, 'warden'),
  };
}

async function loadRegistry(): Promise<Registry> {
  const registry = await fileRegistryStore(join(localDir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run the Gate A provision step first');
  }
  return registry;
}

function writePrivate(name: string, value: unknown): void {
  writeFileSync(join(wardenDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(wardenDir, name), 'utf8')) as unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

function record(rows: Row[], row: Omit<Row, 'result'> & { readonly pass: boolean }): void {
  const entry: Row = {
    step: row.step,
    expected: row.expected,
    actual: row.actual,
    result: row.pass ? 'PASS' : 'FAIL',
    ...(row.hash === undefined ? {} : { hash: row.hash }),
  };
  rows.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

/** Writes the Warden's directory from the registry: configuration, keys, evidence and the callers' secrets. */
async function prepare(): Promise<void> {
  if (existsSync(join(wardenDir, 'events.jsonl'))) {
    throw new Error(
      'the Warden already has an event log here; remove its directory to start a fresh run',
    );
  }
  const roster = rosterOf(await loadRegistry());
  mkdirSync(wardenDir, { recursive: true, mode: 0o700 });
  const secret = (): string => randomBytes(32).toString('base64');
  const callers: CallersFile = {
    schemaVersion: 1,
    principals: [
      { id: 'agent-1', role: 'agent', secret: secret() },
      { id: 'operator-a', role: 'operator', secret: secret() },
      { id: 'operator-b', role: 'operator', secret: secret() },
    ],
  };
  if (roster.warden.seed === undefined) {
    throw new Error('the registry holds no Warden seed');
  }
  const config = WardenConfigFile.parse({
    schemaVersion: 1,
    buyerScope: 'buyer-gate-b-testnet',
    policyVersion: POLICY_VERSION,
    expectedAsset: {
      currency: 'USD',
      ledgerCurrency: TEST_TOKEN_CURRENCY,
      issuer: roster.issuer.address,
    },
    alternateAssets: [],
    spendingAddress: roster.spending.address,
    agentAddress: roster.agent.address,
    wardenAddress: roster.warden.address,
    coolingOffHours: 0,
    matchTolerance: { absoluteMinor: 100, basisPoints: 100 },
    limits: {
      perPaymentMinor: HIGH_LIMIT_MINOR,
      supplierDailyMinor: 200_000,
      dailyTotalMinor: 300_000,
    },
    submission: { pollMs: 2000, maxPolls: 120 },
    listen: LISTEN,
    verifiedPayees: [roster.supplier.address],
  });
  const now = new Date().toISOString();
  const evidence = EvidenceFile.parse({
    schemaVersion: 1,
    invoices: INVOICES.map((invoice) => ({
      fingerprint: fingerprintOf(invoice.label),
      supplierId: SUPPLIER_ID,
      invoiceNumber: invoice.label,
      currency: 'USD',
      amountMinor: invoice.amountMinor,
      purchaseOrderId: `PO-${invoice.label}`,
      payeeAccountAsPrinted: invoice.otherPayee ? roster.agent.address : null,
    })),
    purchaseOrders: INVOICES.map((invoice) => ({
      purchaseOrderId: `PO-${invoice.label}`,
      supplierId: SUPPLIER_ID,
      currency: 'USD',
      amountMinor: invoice.amountMinor,
    })),
    goodsReceipts: INVOICES.filter((invoice) => invoice.receipt).map((invoice) => ({
      purchaseOrderId: `PO-${invoice.label}`,
      receivedMinor: invoice.amountMinor,
      receivedAt: now,
    })),
  });
  const keys = {
    schemaVersion: 1,
    wardenSeed: roster.warden.seed,
    principals: callers.principals,
  };
  writePrivate('warden-config.json', config);
  writePrivate('warden-keys.json', keys);
  writePrivate('warden-callers.json', callers);
  writePrivate('evidence.json', evidence);
  process.stdout.write(
    `${JSON.stringify({ prepared: wardenDir, invoices: INVOICES.length, principals: callers.principals.length, testAsset: TEST_TOKEN_CURRENCY })}\n`,
  );
}

interface Session {
  readonly baseUrl: string;
  readonly port: LedgerPort;
  readonly warden: WardenClient;
  readonly operatorA: WardenClient;
  readonly operatorB: WardenClient;
  readonly roster: Roster;
  readonly agentWallet: Wallet;
  readonly issuerWallet: Wallet;
}

function clientFor(baseUrl: string, callers: CallersFile, id: string): WardenClient {
  const principal = callers.principals.find((entry) => entry.id === id);
  if (principal === undefined) {
    throw new Error(`the callers file has no ${id}`);
  }
  return new WardenClient({
    baseUrl,
    principalId: id,
    secret: Buffer.from(principal.secret, 'base64'),
  });
}

async function connectFirstAvailable(): Promise<LedgerPort> {
  for (const endpoint of testnetEndpoints()) {
    try {
      return await connectTestnetPort(endpoint);
    } catch {
      process.stderr.write('a testnet endpoint did not answer; trying the next\n');
    }
  }
  throw new Error('no testnet endpoint answered');
}

async function openSession(): Promise<Session> {
  const config = WardenConfigFile.parse(readJson('warden-config.json'));
  const callers = CallersFile.parse(readJson('warden-callers.json'));
  const registry = await loadRegistry();
  const roster = rosterOf(registry);
  const baseUrl = `http://${config.listen.host}:${String(config.listen.port)}`;
  return {
    baseUrl,
    port: await connectFirstAvailable(),
    warden: clientFor(baseUrl, callers, 'agent-1'),
    operatorA: clientFor(baseUrl, callers, 'operator-a'),
    operatorB: clientFor(baseUrl, callers, 'operator-b'),
    roster,
    agentWallet: walletOf(roster.agent),
    issuerWallet: walletOf(roster.issuer),
  };
}

/** A proposal as the agent builds it for one invoice and the policy version the Warden reported. */
function proposalFor(
  attemptId: string,
  label: string,
  amountMinor: number,
  policyVersion: string,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    obligationKey: obligationKey(SUPPLIER_ID, label),
    attemptId,
    supplierId: SUPPLIER_ID,
    currency: 'USD',
    amountMinor,
    invoiceFingerprint: fingerprintOf(label),
    policyVersion,
    proposedBy: 'agent',
    proposedAt: new Date().toISOString(),
  };
}

function invoiceOf(label: string): Invoice {
  const invoice = INVOICES.find((item) => item.label === label);
  if (invoice === undefined) {
    throw new Error(`no invoice named ${label} in this run`);
  }
  return invoice;
}

/** The first refusal code a decision gives, or 'none' for an ALLOW. */
function reasonOf(decision: {
  readonly decision: string;
  readonly reasons: readonly { readonly code: string }[];
}): string {
  return decision.decision === 'ALLOW'
    ? 'ALLOW'
    : `${decision.decision} ${decision.reasons[0]?.code ?? 'none'}`;
}

/** Waits until the ledger reports a hash as validated, so a result is only read once it is final. */
async function waitValidated(port: LedgerPort, hash: string): Promise<LedgerLookup> {
  for (let poll = 0; poll < 90; poll += 1) {
    const lookup = await port.lookup(hash);
    if (lookup.status === 'validated') {
      return lookup;
    }
    await sleep(2000);
  }
  throw new Error('a transaction did not validate within the poll budget');
}

/** The issuer sets or clears the freeze on the spending account's test-token line. */
async function setIssuerFreeze(session: Session, flag: number): Promise<string> {
  const tx: TrustSet = {
    TransactionType: 'TrustSet',
    Account: session.roster.issuer.address,
    LimitAmount: {
      currency: TEST_TOKEN_CURRENCY,
      issuer: session.roster.spending.address,
      value: '0',
    },
    Flags: flag,
  };
  const prepared: SubmittableTransaction = await session.port.autofill(tx, 0);
  const signed = session.issuerWallet.sign(prepared);
  await session.port.submit(signed.tx_blob);
  const lookup = await waitValidated(session.port, signed.hash);
  if (lookup.status !== 'validated' || lookup.engineResult !== 'tesSUCCESS') {
    throw new Error('the freeze change did not validate as tesSUCCESS');
  }
  return signed.hash;
}

/** Checks that a validated payment delivered exactly the minor amount, read from the ledger. */
async function deliveredOk(
  port: LedgerPort,
  hash: string,
  amountMinor: number,
): Promise<{ readonly pass: boolean; readonly actual: string }> {
  const lookup = await waitValidated(port, hash);
  const expected = minorToDecimal(amountMinor, 'USD');
  if (lookup.status !== 'validated' || lookup.delivered.kind !== 'iou') {
    return { pass: false, actual: 'not validated as an issued-token payment' };
  }
  const pass =
    lookup.engineResult === 'tesSUCCESS' &&
    compareDecimal(lookup.delivered.amount.value, expected) === 0;
  return { pass, actual: `${lookup.engineResult} delivered ${expected}` };
}

/** Proposes, co-signs and waits for the ledger. Returns the Warden's outcome for the attempt. */
async function payInvoice(session: Session, label: string, policyVersion: string) {
  const invoice = invoiceOf(label);
  const attemptId = randomUUID();
  const reply = await session.warden.propose(
    proposalFor(attemptId, label, invoice.amountMinor, policyVersion),
  );
  if (reply.toCoSign === null) {
    return { reply, outcome: null };
  }
  const outcome = await session.warden.coSign(
    attemptId,
    coSignAsAgent(session.agentWallet, reply.toCoSign),
  );
  return { reply, outcome };
}

async function runB1(rows: Row[], session: Session): Promise<void> {
  const health = await session.warden.health();
  record(rows, {
    step: 'B1 health',
    expected: 'not paused',
    actual: health.paused ? 'paused' : 'not paused',
    pass: !health.paused,
  });
  let version = health.policyVersion;

  const rawProposal = await fetch(new URL('/v1/proposals', session.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  record(rows, {
    step: 'B1 unauthenticated proposal refused',
    expected: '401',
    actual: String(rawProposal.status),
    pass: rawProposal.status === 401,
  });

  const supplier = generateSupplierKey();
  await session.operatorA.enrolSupplier({
    supplierId: SUPPLIER_ID,
    payee: { address: session.roster.supplier.address, destinationTag: null },
    publicKey: supplier.publicKey,
  });
  await session.operatorB.approveSupplier(SUPPLIER_ID);
  record(rows, {
    step: 'B9 enrolment with simulated identity check, second approver',
    expected: 'enrolled and approved',
    actual: 'enrolled and approved',
    pass: true,
  });

  // B1: a payment that passes every rule is co-signed by the agent, signed by the Warden, and paid.
  const paid = await payInvoice(session, 'GB-B1-001', version);
  record(rows, {
    step: 'B1 proposal of a complete invoice',
    expected: 'ALLOW',
    actual: reasonOf(paid.reply.decision),
    pass: paid.reply.decision.decision === 'ALLOW',
  });
  if (paid.outcome !== null) {
    record(rows, {
      step: 'B1 co-signed payment settled',
      expected: 'paid',
      actual: paid.outcome.outcome,
      pass: paid.outcome.outcome === 'paid',
      hash: paid.outcome.hash,
    });
    const delivered = await deliveredOk(session.port, paid.outcome.hash, 1000);
    record(rows, {
      step: 'B1 ledger: validated and delivered',
      expected: `tesSUCCESS delivered ${minorToDecimal(1000, 'USD')}`,
      actual: delivered.actual,
      pass: delivered.pass,
      hash: paid.outcome.hash,
    });
  }

  // B2 and B3 to B5 are refusals that each name a reason. A duplicate of the paid payable is held.
  const duplicate = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B1-001', 1000, version),
  );
  record(rows, {
    step: 'B2 duplicate of a paid payable',
    expected: 'HOLD DUPLICATE',
    actual: reasonOf(duplicate.decision),
    pass: reasonOf(duplicate.decision) === 'HOLD DUPLICATE',
  });

  const changed = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B3-001', 1000, version),
  );
  record(rows, {
    step: 'B3 invoice prints another account',
    expected: 'HOLD PAYEE_CHANGED',
    actual: reasonOf(changed.decision),
    pass: reasonOf(changed.decision) === 'HOLD PAYEE_CHANGED',
  });

  const noReceipt = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B4-001', 1000, version),
  );
  record(rows, {
    step: 'B4 no goods receipt',
    expected: 'HOLD MISSING_EVIDENCE',
    actual: reasonOf(noReceipt.decision),
    pass: reasonOf(noReceipt.decision) === 'HOLD MISSING_EVIDENCE',
  });

  const overLimit = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B5-001', 60_000, version),
  );
  record(rows, {
    step: 'B5 above the per-payment limit',
    expected: 'HOLD OVER_LIMIT',
    actual: reasonOf(overLimit.decision),
    pass: reasonOf(overLimit.decision) === 'HOLD OVER_LIMIT',
  });

  // B2: five concurrent proposals for one payable: exactly one proceeds.
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () =>
      session.warden.propose(proposalFor(randomUUID(), 'GB-B2-001', 1000, version)),
    ),
  );
  const allowed = concurrent.filter((reply) => reply.decision.decision === 'ALLOW');
  const others = concurrent.filter((reply) => reply.decision.decision !== 'ALLOW');
  record(rows, {
    step: 'B2 five concurrent proposals, one payable',
    expected: '1 ALLOW, 4 HOLD DUPLICATE',
    actual: `${String(allowed.length)} ALLOW, ${String(others.length)} ${others.every((reply) => reasonOf(reply.decision) === 'HOLD DUPLICATE') ? 'HOLD DUPLICATE' : 'other'}`,
    pass:
      allowed.length === 1 &&
      others.every((reply) => reasonOf(reply.decision) === 'HOLD DUPLICATE'),
  });
  const winner = allowed[0];
  if (typeof winner?.attemptId === 'string' && winner.toCoSign !== null) {
    const outcome = await session.warden.coSign(
      winner.attemptId,
      coSignAsAgent(session.agentWallet, winner.toCoSign),
    );
    record(rows, {
      step: 'B2 the one proceeding payable settles',
      expected: 'paid',
      actual: outcome.outcome,
      pass: outcome.outcome === 'paid',
      hash: outcome.hash,
    });
    const delivered = await deliveredOk(session.port, outcome.hash, 1000);
    record(rows, {
      step: 'B2 ledger: validated and delivered',
      expected: `tesSUCCESS delivered ${minorToDecimal(1000, 'USD')}`,
      actual: delivered.actual,
      pass: delivered.pass,
      hash: outcome.hash,
    });
  }

  // B6: a transaction that is not the approved payment is refused at co-signature.
  const b6Attempt = randomUUID();
  const b6 = await session.warden.propose(proposalFor(b6Attempt, 'GB-B6-001', 1000, version));
  record(rows, {
    step: 'B6 proposal for the transaction-type check',
    expected: 'ALLOW',
    actual: reasonOf(b6.decision),
    pass: b6.decision.decision === 'ALLOW',
  });
  if (b6.toCoSign !== null) {
    const fields: Record<string, unknown> = { ...decode(b6.toCoSign) };
    delete fields['Signers'];
    fields['TransactionType'] = 'AccountSet';
    delete fields['Amount'];
    delete fields['Destination'];
    delete fields['DestinationTag'];
    const altered = signAsSigner(session.agentWallet, fields as unknown as SubmittableTransaction);
    const refusal = await session.warden.coSign(b6Attempt, altered).then(
      () => 'accepted',
      (error: unknown) =>
        error instanceof ClientError ? `refused ${String(error.status)}` : 'refused',
    );
    record(rows, {
      step: 'B6 non-payment transaction at co-signature',
      expected: 'refused 422',
      actual: refusal,
      pass: refusal === 'refused 422',
    });
  }

  // B7: pause through the Warden's own route, then resume. Only the Warden process is running.
  await session.operatorA.setPaused(true);
  const paused = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B7-001', 1000, version),
  );
  record(rows, {
    step: 'B7 proposal while paused',
    expected: 'HOLD PAUSED',
    actual: reasonOf(paused.decision),
    pass: reasonOf(paused.decision) === 'HOLD PAUSED',
  });
  await session.operatorA.setPaused(false);
  const resumed = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B7-002', 1000, version),
  );
  record(rows, {
    step: 'B7 proposal after resume',
    expected: 'ALLOW',
    actual: reasonOf(resumed.decision),
    pass: resumed.decision.decision === 'ALLOW',
  });

  // B5: a lowered limit applies to the next proposal, not to one already decided.
  const before = await session.warden.propose(
    proposalFor(randomUUID(), 'GB-B5-002', 1000, version),
  );
  record(rows, {
    step: 'B5 before the limit is lowered',
    expected: 'ALLOW',
    actual: reasonOf(before.decision),
    pass: before.decision.decision === 'ALLOW',
  });
  const lowered = await session.operatorA.setLimits({ perPaymentMinor: 500 });
  version = (lowered as { readonly policyVersion: string }).policyVersion;
  const after = await session.warden.propose(proposalFor(randomUUID(), 'GB-B5-003', 1000, version));
  record(rows, {
    step: 'B5 after the limit is lowered',
    expected: 'HOLD OVER_LIMIT',
    actual: reasonOf(after.decision),
    pass: reasonOf(after.decision) === 'HOLD OVER_LIMIT',
  });
  const restored = await session.operatorA.setLimits({ perPaymentMinor: HIGH_LIMIT_MINOR });
  version = (restored as { readonly policyVersion: string }).policyVersion;
  record(rows, {
    step: 'B5 limit restored for the next run',
    expected: 'policy version changed',
    actual: version === POLICY_VERSION ? 'unchanged' : 'changed',
    pass: version !== POLICY_VERSION,
  });
}

async function runB8(rows: Row[], session: Session): Promise<void> {
  const frozen = await setIssuerFreeze(session, TF_SET_FREEZE);
  record(rows, {
    step: 'B8 issuer freezes the spending line',
    expected: 'tesSUCCESS',
    actual: 'tesSUCCESS',
    pass: true,
    hash: frozen,
  });
  const line = await session.port.trustLine(session.roster.spending.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer: session.roster.issuer.address,
  });
  record(rows, {
    step: 'B8 ledger reports the line frozen by the issuer',
    expected: 'frozen',
    actual: line?.frozenByIssuer === true ? 'frozen' : 'not frozen',
    pass: line?.frozenByIssuer === true,
  });

  const health = await session.warden.health();
  const version = health.policyVersion;
  const held = await session.warden.propose(proposalFor(randomUUID(), 'GB-B8-001', 1000, version));
  record(rows, {
    step: 'B8 proposal while the line is frozen',
    expected: 'HOLD ACCOUNT_FROZEN',
    actual: reasonOf(held.decision),
    pass: reasonOf(held.decision) === 'HOLD ACCOUNT_FROZEN',
  });

  const unfrozen = await setIssuerFreeze(session, TF_CLEAR_FREEZE);
  record(rows, {
    step: 'B8 issuer unfreezes the spending line',
    expected: 'tesSUCCESS',
    actual: 'tesSUCCESS',
    pass: true,
    hash: unfrozen,
  });
  const cleared = await session.port.trustLine(session.roster.spending.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer: session.roster.issuer.address,
  });
  record(rows, {
    step: 'B8 ledger reports the line not frozen',
    expected: 'not frozen',
    actual: cleared?.frozenByIssuer === false ? 'not frozen' : 'frozen',
    pass: cleared?.frozenByIssuer === false,
  });

  const paid = await payInvoice(session, 'GB-B8-001', version);
  record(rows, {
    step: 'B8 proposal after the unfreeze',
    expected: 'ALLOW',
    actual: reasonOf(paid.reply.decision),
    pass: paid.reply.decision.decision === 'ALLOW',
  });
  if (paid.outcome !== null) {
    record(rows, {
      step: 'B8 co-signed payment settled',
      expected: 'paid',
      actual: paid.outcome.outcome,
      pass: paid.outcome.outcome === 'paid',
      hash: paid.outcome.hash,
    });
    const delivered = await deliveredOk(session.port, paid.outcome.hash, 1000);
    record(rows, {
      step: 'B8 ledger: validated and delivered',
      expected: `tesSUCCESS delivered ${minorToDecimal(1000, 'USD')}`,
      actual: delivered.actual,
      pass: delivered.pass,
      hash: paid.outcome.hash,
    });
  }
}

/**
 * P0 Testnet NEGATIVE proof on a fresh Warden directory. This intentionally attempts
 * a single-agent-signature transaction to verify that the ledger refuses it, then
 * proves a late operator pause prevents Warden from providing the second signature.
 * No Warden signature is emitted to the caller, and no payment should settle.
 */
async function runP0Stop(rows: Row[], session: Session): Promise<void> {
  const health = await session.warden.health();
  if (health.paused) {
    throw new Error('p0-stop requires a fresh, unpaused Testnet Warden session');
  }
  const supplier = generateSupplierKey();
  await session.operatorA.enrolSupplier({
    supplierId: SUPPLIER_ID,
    payee: { address: session.roster.supplier.address, destinationTag: null },
    publicKey: supplier.publicKey,
  });
  await session.operatorB.approveSupplier(SUPPLIER_ID);

  const invoice = invoiceOf('GB-P0-001');
  const attemptId = randomUUID();
  const proposal = await session.warden.propose(
    proposalFor(attemptId, invoice.label, invoice.amountMinor, health.policyVersion),
  );
  record(rows, {
    step: 'P0 valid proposal is authorized for preparation',
    expected: 'ALLOW',
    actual: reasonOf(proposal.decision),
    pass: proposal.decision.decision === 'ALLOW',
  });
  if (proposal.toCoSign === null) {
    return;
  }

  const prepared = decode(proposal.toCoSign) as { readonly Signers?: unknown[] };
  record(rows, {
    step: 'P0 prepared terms expose NO Warden signature',
    expected: '0 signers',
    actual: `${String(prepared.Signers?.length ?? 0)} signers`,
    pass: prepared.Signers === undefined,
  });
  if (prepared.Signers !== undefined) {
    return;
  }

  const agentOnly = coSignAsAgent(session.agentWallet, proposal.toCoSign);
  const signed = decode(agentOnly) as { readonly Signers?: unknown[] };
  const signerCount = signed.Signers?.length ?? 0;
  record(rows, {
    step: 'P0 captured agent-side transaction has only one signer',
    expected: '1 signer',
    actual: `${String(signerCount)} signer`,
    pass: signerCount === 1,
  });

  const before = await session.port.trustLine(session.roster.supplier.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer: session.roster.issuer.address,
  });
  const attempted = await session.port.submit(agentOnly);
  record(rows, {
    step: 'P0 ledger rejects an agent-only direct broadcast',
    expected: 'tefBAD_QUORUM',
    actual: attempted.engineResult,
    pass: attempted.engineResult === 'tefBAD_QUORUM',
  });

  await session.operatorA.setPaused(true);
  try {
    let blockedStatus = 0;
    try {
      await session.warden.coSign(attemptId, agentOnly);
    } catch (error) {
      if (error instanceof ClientError) {
        blockedStatus = error.status;
      } else {
        throw error;
      }
    }
    record(rows, {
      step: 'P0 Warden rejects finalization after late operator STOP',
      expected: '409',
      actual: String(blockedStatus),
      pass: blockedStatus === 409,
    });
  } finally {
    // Undo only this run's own pause; never unpause a session that started paused.
    await session.operatorA.setPaused(false);
  }

  const after = await session.port.trustLine(session.roster.supplier.address, {
    currency: TEST_TOKEN_CURRENCY,
    issuer: session.roster.issuer.address,
  });
  record(rows, {
    step: 'P0 recipient balance unchanged by rejected bypass',
    expected: 'unchanged test-token balance',
    actual: before?.balance === after?.balance ? 'unchanged test-token balance' : 'changed',
    pass: before?.balance !== undefined && before.balance === after?.balance,
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  if (!['prepare', 'health', 'b1', 'b8', 'p0-stop'].includes(command)) {
    process.stderr.write('usage: gate-b <prepare|health|b1|b8|p0-stop>\n');
    process.exitCode = 2;
    return;
  }
  assertOutsideRepository(localDir, repoRoot);
  if (command === 'prepare') {
    await prepare();
    return;
  }
  const session = await openSession();
  try {
    if (command === 'health') {
      process.stdout.write(`${JSON.stringify(await session.warden.health())}\n`);
      return;
    }
    const rows: Row[] = [];
    if (command === 'b1') {
      await runB1(rows, session);
    } else if (command === 'b8') {
      await runB8(rows, session);
    } else {
      await runP0Stop(rows, session);
    }
    const failed = rows.filter((row) => row.result === 'FAIL').length;
    process.stdout.write(`${JSON.stringify({ command, rows: rows.length, failed })}\n`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await session.port.disconnect();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof ClientError
      ? `warden refused the request with ${String(error.status)}`
      : 'the gate-b run failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
