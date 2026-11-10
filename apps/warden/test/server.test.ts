import { createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { decode, Wallet, type SubmittableTransaction } from 'xrpl';

import { hashOfSigned, signAsSigner } from '../../../packages/xrpl/src/index.js';
import { RequestVerifier, signatureFor, signingText, type Principal } from '../src/auth.js';
import { canonicalJson } from '../src/canonical.js';
import {
  ClientError,
  coSignAsAgent,
  generateSupplierKey,
  SupplierClient,
  WardenClient,
} from '../src/client.js';
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

// Generated for each run, so no secret-looking literal is written into the test.
const AGENT_SECRET = randomBytes(32);
const OPERATOR_A_SECRET = randomBytes(32);
const OPERATOR_B_SECRET = randomBytes(32);

const PRINCIPALS: ReadonlyMap<string, Principal> = new Map<string, Principal>([
  ['agent-1', { id: 'agent-1', role: 'agent', secret: AGENT_SECRET }],
  ['operator-a', { id: 'operator-a', role: 'operator', secret: OPERATOR_A_SECRET }],
  ['operator-b', { id: 'operator-b', role: 'operator', secret: OPERATOR_B_SECRET }],
]);

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
  readonly url: string;
  readonly config: ReturnType<typeof configFor>;
  readonly service: WardenService;
  readonly agent: WardenClient;
  readonly operatorA: WardenClient;
  readonly operatorB: WardenClient;
}

function clientFor(url: string, principalId: string, secret: Buffer, clock: Clock): WardenClient {
  return new WardenClient({ baseUrl: url, principalId, secret, now: () => clock.now });
}

/** A Warden served over HTTP, with its own ledger and clock. No other process is involved. */
async function harness(): Promise<Harness> {
  const base = await provisionedBase();
  const config = configFor(base);
  const clock = newClock();
  const service = await openService(base, config, evidenceFrom([STANDARD]), { clock });
  const verifier = new RequestVerifier(PRINCIPALS, () => clock.now, START.getTime());
  const url = await listen(createWardenServer(service, verifier, () => undefined));
  return {
    base,
    clock,
    url,
    config,
    service,
    agent: clientFor(url, 'agent-1', AGENT_SECRET, clock),
    operatorA: clientFor(url, 'operator-a', OPERATOR_A_SECRET, clock),
    operatorB: clientFor(url, 'operator-b', OPERATOR_B_SECRET, clock),
  };
}

/** Enrols and approves the supplier over HTTP, with two different operators. */
async function activeSupplierOverHttp(h: Harness, publicKey: string): Promise<void> {
  await h.operatorA.enrolSupplier({
    supplierId: SUPPLIER,
    payee: { address: h.base.supplierAccount.address, destinationTag: null },
    publicKey,
  });
  await h.operatorB.approveSupplier(SUPPLIER);
}

/** A raw request, signed as a client would sign it, for cases the client itself will not send. */
async function raw(
  h: Harness,
  method: string,
  path: string,
  body: string,
  options: { readonly principal?: string; readonly secret?: Buffer } = {},
): Promise<Response> {
  const timestamp = h.clock.now.toISOString();
  const nonce = randomBytes(16).toString('hex');
  const principal = options.principal ?? 'agent-1';
  const secret = options.secret ?? AGENT_SECRET;
  return fetch(new URL(path, h.url), {
    method,
    headers: {
      'content-type': 'application/json',
      'x-signoff-principal': principal,
      'x-signoff-timestamp': timestamp,
      'x-signoff-nonce': nonce,
      'x-signoff-signature': signatureFor(
        secret,
        signingText(method, path, timestamp, nonce, body),
      ),
    },
    body,
  });
}

describe('the Warden over HTTP', () => {
  it('pays a proposal end to end: the agent proposes, co-signs, and the Warden submits', async () => {
    const h = await harness();
    await activeSupplierOverHttp(h, generateSupplierKey().publicKey);
    const attemptId = newAttemptId();
    const proposed = await h.agent.propose(proposalFor(attemptId, STANDARD, h.config, h.clock.now));
    expect(proposed.decision.decision).toBe('ALLOW');
    const outcome = await h.agent.coSign(
      attemptId,
      coSignAsAgent(h.base.agentWallet, proposed.toCoSign ?? ''),
    );
    expect(outcome).toMatchObject({ attemptId, outcome: 'paid' });
    expect(outcome.hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it('answers the health check without authentication', async () => {
    const h = await harness();
    const response = await fetch(new URL('/v1/health', h.url));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paused: false, policyVersion: h.config.policyVersion });
  });

  it('pauses and resumes through its own operator route, with no console or other process running', async () => {
    const h = await harness();
    await activeSupplierOverHttp(h, generateSupplierKey().publicKey);
    expect(await h.operatorA.setPaused(true)).toEqual({ paused: true });
    expect(await h.agent.health()).toEqual({ paused: true, policyVersion: h.config.policyVersion });
    const held = await h.agent.propose(
      proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now),
    );
    expect(held.decision.reasons[0]?.code).toBe('PAUSED');
    expect(await h.operatorA.setPaused(false)).toEqual({ paused: false });
    const resumed = await h.agent.propose(
      proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now),
    );
    expect(resumed.decision.decision).toBe('ALLOW');
  });

  it('refuses a request with no authentication, a forged signature, or a principal for the other role, with 401', async () => {
    const h = await harness();
    const body = JSON.stringify(proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now));
    const none = await fetch(new URL('/v1/proposals', h.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'authentication required' });
    const forged = await raw(h, 'POST', '/v1/proposals', body, { secret: OPERATOR_A_SECRET });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: 'authentication failed' });
    const wrongRole = await raw(h, 'POST', '/v1/control/pause', '{}', { principal: 'agent-1' });
    expect(wrongRole.status).toBe(401);
  });

  it('gives a caller the refusal message from the Warden as a client error', async () => {
    const h = await harness();
    const wrongSecret = clientFor(h.url, 'agent-1', OPERATOR_A_SECRET, h.clock);
    await expect(wrongSecret.propose({})).rejects.toMatchObject({
      status: 401,
      message: 'authentication failed',
    });
  });

  it('refuses a body that is not JSON, one that does not match its schema, and one that is too large', async () => {
    const h = await harness();
    const notJson = await raw(h, 'POST', '/v1/proposals', 'not json');
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'the body is not JSON' });
    const badCoSign = await raw(
      h,
      'POST',
      `/v1/attempts/${newAttemptId()}/co-signature`,
      JSON.stringify({ signedBlob: 'zz' }),
    );
    expect(badCoSign.status).toBe(400);
    expect(await badCoSign.json()).toEqual({ error: 'the request does not match the schema' });
    const tooLarge = await raw(h, 'POST', '/v1/proposals', 'x'.repeat(70 * 1024));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 'the request body is too large' });
  });

  it('answers an unknown route, or a known route with the wrong method, with 404', async () => {
    const h = await harness();
    expect((await raw(h, 'POST', '/v1/nothing', '{}')).status).toBe(404);
    expect((await fetch(new URL('/v1/proposals', h.url))).status).toBe(404);
    expect(
      (
        await raw(h, 'POST', '/v1/suppliers/bad/approve', '{}', {
          principal: 'operator-a',
          secret: OPERATOR_A_SECRET,
        })
      ).status,
    ).toBe(404);
  });

  it('reports a co-signature for an unknown attempt as 404, and one signed by the agent alone as 422', async () => {
    const h = await harness();
    await activeSupplierOverHttp(h, generateSupplierKey().publicKey);
    await expect(h.agent.coSign(newAttemptId(), 'AABB')).rejects.toMatchObject({ status: 404 });
    const attemptId = newAttemptId();
    const proposed = await h.agent.propose(proposalFor(attemptId, STANDARD, h.config, h.clock.now));
    const fields: Record<string, unknown> = { ...decode(proposed.toCoSign ?? '') };
    delete fields['Signers'];
    const agentOnly = signAsSigner(h.base.agentWallet, fields as unknown as SubmittableTransaction);
    await expect(h.agent.coSign(attemptId, agentOnly)).rejects.toMatchObject({ status: 422 });
  });

  it('turns an unexpected failure into a 500 that reveals nothing, and reports it to the operator', async () => {
    const clock = newClock();
    const stub = {
      setPaused: () => Promise.reject(new Error('internal detail: the disk is full')),
    } as unknown as WardenService;
    const errors: unknown[] = [];
    const url = await listen(
      createWardenServer(
        stub,
        new RequestVerifier(PRINCIPALS, () => clock.now, START.getTime()),
        (error) => {
          errors.push(error);
        },
      ),
    );
    const failure: unknown = await clientFor(url, 'operator-a', OPERATOR_A_SECRET, clock)
      .setPaused(true)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ClientError);
    expect(failure).toMatchObject({ status: 500, message: 'internal error' });
    expect(errors).toHaveLength(1);
  });

  it('accepts a supplier-signed payout change over HTTP, and refuses one signed by another key', async () => {
    const h = await harness();
    const supplier = generateSupplierKey();
    await activeSupplierOverHttp(h, supplier.publicKey);
    const newPayee = { address: Wallet.generate().address, destinationTag: null };
    const stranger = new SupplierClient(h.url, SUPPLIER, generateKeyPairSync('ed25519').privateKey);
    await expect(
      stranger.requestChange({
        newPayee,
        newPublicKey: null,
        requestedAt: h.clock.now.toISOString(),
        nonce: 'nonce-http-stranger-1',
      }),
    ).rejects.toMatchObject({ status: 422 });
    const genuine = new SupplierClient(h.url, SUPPLIER, supplier.privateKey);
    const accepted = await genuine.requestChange({
      newPayee,
      newPublicKey: null,
      requestedAt: h.clock.now.toISOString(),
      nonce: 'nonce-http-genuine-1',
    });
    const { changeId } = accepted as { changeId: string };
    expect(changeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a payout change whose body names a different supplier than the route', async () => {
    const h = await harness();
    const supplier = generateSupplierKey();
    const request = {
      supplierId: SUPPLIER,
      newPayee: { address: Wallet.generate().address, destinationTag: null },
      newPublicKey: null,
      requestedAt: h.clock.now.toISOString(),
      nonce: 'nonce-route-mismatch',
    };
    const signature = sign(
      null,
      Buffer.from(canonicalJson(request), 'utf8'),
      supplier.privateKey,
    ).toString('base64');
    const response = await fetch(new URL('/v1/suppliers/SUP-ZZZZ9999/changes', h.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request, signature }),
    });
    expect(response.status).toBe(400);
  });
});

describe('the operator routes over HTTP', () => {
  it('sets limits, records an approval, and takes a payout change through confirmation and approval', async () => {
    const h = await harness();
    const supplier = generateSupplierKey();
    await activeSupplierOverHttp(h, supplier.publicKey);
    const limits = (await h.operatorA.setLimits({ perPaymentMinor: 500 })) as {
      policyVersion: string;
    };
    expect(limits.policyVersion).toBe('2026-11-10.2');
    const proposal = proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now);
    const approval = (await h.operatorA.approveProposal(proposal)) as {
      fingerprint: string;
      approvals: number;
    };
    expect(approval.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(approval.approvals).toBe(1);
    const change = new SupplierClient(h.url, SUPPLIER, supplier.privateKey);
    const { changeId } = (await change.requestChange({
      newPayee: { address: h.base.supplierAccount.address, destinationTag: null },
      newPublicKey: null,
      requestedAt: h.clock.now.toISOString(),
      nonce: 'nonce-http-operator-1',
    })) as { changeId: string };
    expect(await h.operatorA.confirmChange(SUPPLIER, changeId)).toEqual({});
    expect(await h.operatorB.approveChange(SUPPLIER, changeId)).toEqual({});
    expect(h.service.currentLimits().perPaymentMinor).toBe(500);
  });

  it('refuses a request whose clock is ten minutes out of step with the Warden, with 401', async () => {
    const h = await harness();
    const skewed = new WardenClient({
      baseUrl: h.url,
      principalId: 'operator-a',
      secret: OPERATOR_A_SECRET,
      now: () => new Date(START.getTime() + 10 * 60_000),
    });
    await expect(skewed.setPaused(true)).rejects.toMatchObject({ status: 401 });
    expect(h.service.health().paused).toBe(false);
  });
});

describe('the caller side of the Warden', () => {
  it('reports a refusal that is not JSON as a generic failure, with the status it was sent', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(502, { 'content-type': 'text/html' });
      response.end('<html>bad gateway</html>');
    });
    const url = await listen(server);
    await expect(
      new WardenClient({ baseUrl: url, principalId: 'agent-1', secret: AGENT_SECRET }).health(),
    ).rejects.toMatchObject({
      status: 502,
      message: 'the request failed',
    });
  });

  it('generates an Ed25519 supplier key whose public half is base64 SPKI', () => {
    const key = generateSupplierKey();
    const derived = createPublicKey(key.privateKey).export({ format: 'der', type: 'spki' });
    expect(derived.toString('base64')).toBe(key.publicKey);
    expect(key.privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('combines the Warden signature with the agent signature into one two-signer transaction', async () => {
    const h = await harness();
    await activeSupplierOverHttp(h, generateSupplierKey().publicKey);
    const proposed = await h.agent.propose(
      proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now),
    );
    const combined = coSignAsAgent(h.base.agentWallet, proposed.toCoSign ?? '');
    const signers = (decode(combined) as { Signers?: unknown[] }).Signers ?? [];
    expect(signers).toHaveLength(2);
    expect(hashOfSigned(combined)).toMatch(/^[0-9A-F]{64}$/);
  });

  it('refuses to co-sign something that is not a transaction', () => {
    const agent = Wallet.generate();
    expect(() => coSignAsAgent(agent, 'zz')).toThrow();
  });
});
