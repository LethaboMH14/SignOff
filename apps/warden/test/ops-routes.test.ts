import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { RequestVerifier, signatureFor, signingText, type Principal } from '../src/auth.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { memoryEventLog } from '../src/events.js';
import { createWardenServer } from '../src/server.js';
import type { WardenService } from '../src/service.js';
import {
  configFor,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  provisionedBase,
  proposalFor,
  START,
  STANDARD,
  SUPPLIER,
  type Base,
  type Clock,
} from './helpers/world.js';

/**
 * The operator read routes, over HTTP. Each test runs its own Warden with its own simulated ledger and clock, and
 * no other process. The secrets are generated for each run, so no secret-looking literal is written into the test.
 */

const AGENT = 'agent-1';
const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';
const AGENT_SECRET = randomBytes(32);
const OPERATOR_A_SECRET = randomBytes(32);
const OPERATOR_B_SECRET = randomBytes(32);

const PRINCIPALS: ReadonlyMap<string, Principal> = new Map<string, Principal>([
  [AGENT, { id: AGENT, role: 'agent', secret: AGENT_SECRET }],
  [OPERATOR_A, { id: OPERATOR_A, role: 'operator', secret: OPERATOR_A_SECRET }],
  [OPERATOR_B, { id: OPERATOR_B, role: 'operator', secret: OPERATOR_B_SECRET }],
]);

const COLLECTION_READS = ['/v1/ops/overview', '/v1/ops/proposals', '/v1/ops/suppliers'] as const;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((closed) => {
          server.close(() => {
            closed();
          });
        }),
    ),
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

interface Harness {
  readonly base: Base;
  readonly clock: Clock;
  readonly config: ReturnType<typeof configFor>;
  readonly service: WardenService;
  readonly log: ReturnType<typeof memoryEventLog>;
  readonly url: string;
}

async function harness(): Promise<Harness> {
  const base = await provisionedBase();
  const config = configFor(base);
  const clock = newClock();
  const log = memoryEventLog();
  const service = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
  const verifier = new RequestVerifier(PRINCIPALS, () => clock.now, START.getTime());
  const url = await listen(createWardenServer(service, verifier, () => undefined));
  return { base, clock, config, service, log, url };
}

/** A signed GET, sent the way the operator console sends it. */
function get(
  h: Harness,
  path: string,
  principal: string = OPERATOR_A,
  secret: Buffer = OPERATOR_A_SECRET,
): Promise<Response> {
  const timestamp = h.clock.now.toISOString();
  const nonce = randomBytes(16).toString('hex');
  return fetch(new URL(path, h.url), {
    method: 'GET',
    headers: {
      'x-signoff-principal': principal,
      'x-signoff-timestamp': timestamp,
      'x-signoff-nonce': nonce,
      'x-signoff-signature': signatureFor(secret, signingText('GET', path, timestamp, nonce, '')),
    },
  });
}

/** Enrols the supplier with one operator and approves it with a second, as the operator process does. */
async function activeSupplier(h: Harness): Promise<void> {
  await h.service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: h.base.supplierAccount.address, destinationTag: null },
      publicKey: generateSupplierKey().publicKey,
    },
    OPERATOR_A,
  );
  await h.service.approveSupplier(SUPPLIER, OPERATOR_B);
}

/** Proposes the standard invoice, which is allowed, then co-signs and submits it. Returns the attempt id. */
async function payStandard(h: Harness): Promise<string> {
  const attemptId = newAttemptId();
  const reply = await h.service.propose(proposalFor(attemptId, STANDARD, h.config, h.clock.now));
  if (reply.toCoSign === null) {
    throw new Error('the standard proposal should have been allowed');
  }
  const outcome = await h.service.coSign(
    attemptId,
    coSignAsAgent(h.base.agentWallet, reply.toCoSign),
  );
  expect(outcome.outcome).toBe('paid');
  return attemptId;
}

describe('the operator reads over HTTP', () => {
  it('refuses an unsigned read', async () => {
    const h = await harness();
    for (const path of COLLECTION_READS) {
      const response = await fetch(new URL(path, h.url));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'authentication required' });
    }
  });

  it('refuses the agent principal on every operator read', async () => {
    const h = await harness();
    for (const path of COLLECTION_READS) {
      const response = await get(h, path, AGENT, AGENT_SECRET);
      expect(response.status).toBe(401);
    }
  });

  it('refuses a read signed with another principal secret', async () => {
    const h = await harness();
    const response = await get(h, '/v1/ops/overview', OPERATOR_A, OPERATOR_B_SECRET);
    expect(response.status).toBe(401);
  });

  it('answers the overview with the limits in force and the amount used today', async () => {
    const h = await harness();
    await activeSupplier(h);
    await payStandard(h);
    const response = await get(h, '/v1/ops/overview');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paused: false,
      policyVersion: h.config.policyVersion,
      limits: h.config.initialLimits,
      usageToday: { day: '2026-11-10', totalMinor: STANDARD.amountMinor },
      pendingLimitChange: null,
    });
  });

  it('lists proposals newest first, each with its decision, its reasons and its payment', async () => {
    const h = await harness();
    await activeSupplier(h);
    const paidId = await payStandard(h);
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await h.service.setPaused(true, OPERATOR_A);
    const heldId = newAttemptId();
    await h.service.propose(proposalFor(heldId, STANDARD, h.config, h.clock.now));
    const response = await get(h, '/v1/ops/proposals');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly proposals: readonly {
        readonly attemptId: string;
        readonly decision: string;
        readonly reasons: readonly { readonly code: string }[];
        readonly payment: { readonly status: string } | null;
      }[];
    };
    expect(body.proposals.map((proposal) => proposal.attemptId)).toEqual([heldId, paidId]);
    expect(body.proposals[0]).toMatchObject({
      decision: 'HOLD',
      reasons: [{ code: 'PAUSED' }],
      payment: null,
    });
    expect(body.proposals[1]).toMatchObject({ decision: 'ALLOW', payment: { status: 'paid' } });
  });

  it('returns one proposal by its attempt id, and not found for an id with no decision', async () => {
    const h = await harness();
    await activeSupplier(h);
    const paidId = await payStandard(h);
    const found = await get(h, `/v1/ops/proposals/${paidId}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ attemptId: paidId, decision: 'ALLOW' });
    const missing = await get(h, `/v1/ops/proposals/${newAttemptId()}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'no such proposal' });
  });

  it('lists suppliers without their public keys', async () => {
    const h = await harness();
    await activeSupplier(h);
    const response = await get(h, '/v1/ops/suppliers');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly suppliers: readonly Record<string, unknown>[];
    };
    expect(body.suppliers).toHaveLength(1);
    expect(Object.keys(body.suppliers[0] ?? {}).sort()).toEqual([
      'approvedBy',
      'change',
      'enrolledBy',
      'payee',
      'status',
      'supplierId',
    ]);
    expect(JSON.stringify(body)).not.toContain('publicKey');
  });

  it('changes nothing: the event log is the same length after every read', async () => {
    const h = await harness();
    await activeSupplier(h);
    const attemptId = await payStandard(h);
    const before = h.log.events().length;
    for (const path of [...COLLECTION_READS, `/v1/ops/proposals/${attemptId}`]) {
      expect((await get(h, path)).status).toBe(200);
    }
    expect(h.log.events()).toHaveLength(before);
  });

  it('answers with no-store and nosniff headers, and no signing material or invoice identifiers', async () => {
    const h = await harness();
    await activeSupplier(h);
    const attemptId = await payStandard(h);
    const response = await get(h, `/v1/ops/proposals/${attemptId}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const text = await response.text();
    for (const forbidden of [
      'wardenBlob',
      'finalBlob',
      'txFields',
      'scopedKey',
      'invoiceFingerprint',
      'lastLedgerSequence',
      'issuer',
      'TxnSignature',
      'publicKey',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('serves reads by GET only: the same path with POST is not a route', async () => {
    const h = await harness();
    const timestamp = h.clock.now.toISOString();
    const nonce = randomBytes(16).toString('hex');
    const response = await fetch(new URL('/v1/ops/overview', h.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signoff-principal': OPERATOR_A,
        'x-signoff-timestamp': timestamp,
        'x-signoff-nonce': nonce,
        'x-signoff-signature': signatureFor(
          OPERATOR_A_SECRET,
          signingText('POST', '/v1/ops/overview', timestamp, nonce, ''),
        ),
      },
    });
    expect(response.status).toBe(404);
  });

  it('answers a malformed proposal id as no route at all', async () => {
    const h = await harness();
    const response = await get(h, '/v1/ops/proposals/not-an-id');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });
});
