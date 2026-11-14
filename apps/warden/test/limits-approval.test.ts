import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { RequestVerifier, signatureFor, signingText, type Principal } from '../src/auth.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { memoryEventLog } from '../src/events.js';
import { createWardenServer } from '../src/server.js';
import { LIMIT_INCREASE_WINDOW_MS, type WardenService } from '../src/service.js';
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
 * Raising a limit needs a second operator. Lowering one applies at once. The secrets are generated for each run, so no
 * secret-looking literal is written into the test.
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

/** Enrols and approves a supplier with two operators, so proposals can be made and paid. */
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

/** A signed POST, sent the way an operator client sends it. */
function post(
  h: Harness,
  path: string,
  body: unknown,
  principal: string,
  secret: Buffer,
): Promise<Response> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const timestamp = h.clock.now.toISOString();
  const nonce = randomBytes(16).toString('hex');
  return fetch(new URL(path, h.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signoff-principal': principal,
      'x-signoff-timestamp': timestamp,
      'x-signoff-nonce': nonce,
      'x-signoff-signature': signatureFor(
        secret,
        signingText('POST', path, timestamp, nonce, text),
      ),
    },
    ...(text === '' ? {} : { body: text }),
  });
}

describe('limit changes', () => {
  it('applies a lowered limit at once, under a new policy version', async () => {
    const h = await harness();
    const outcome = await h.service.setLimits({ perPaymentMinor: 500 }, OPERATOR_A);
    expect(outcome).toMatchObject({ applied: true });
    expect(h.service.currentLimits().perPaymentMinor).toBe(500);
    expect(h.service.currentLimits().policyVersion).not.toBe(h.config.policyVersion);
  });

  it('holds a raised limit until a second operator approves it', async () => {
    const h = await harness();
    const outcome = await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    if (outcome.applied) {
      throw new Error('a raised limit must wait for approval');
    }
    expect(h.service.currentLimits().perPaymentMinor).toBe(h.config.initialLimits.perPaymentMinor);
    expect(h.service.opsOverview().pendingLimitChange).toMatchObject({
      requestId: outcome.requestId,
      requestedBy: OPERATOR_A,
      perPaymentMinor: 200_000,
      expiresAt: outcome.expiresAt,
    });
    const approved = await h.service.approveLimits(outcome.requestId, OPERATOR_B);
    expect(h.service.currentLimits().perPaymentMinor).toBe(200_000);
    expect(h.service.currentLimits().policyVersion).toBe(approved.policyVersion);
    expect(h.service.opsOverview().pendingLimitChange).toBeNull();
  });

  it('refuses the approval by the person who asked for the raise', async () => {
    const h = await harness();
    const outcome = await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    if (outcome.applied) {
      throw new Error('a raised limit must wait for approval');
    }
    await expect(h.service.approveLimits(outcome.requestId, OPERATOR_A)).rejects.toMatchObject({
      status: 422,
    });
    expect(h.service.currentLimits().perPaymentMinor).toBe(h.config.initialLimits.perPaymentMinor);
  });

  it('refuses a second raise while one is waiting, and an approval of an unknown request', async () => {
    const h = await harness();
    await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    await expect(
      h.service.setLimits({ supplierDailyMinor: 900_000 }, OPERATOR_B),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.approveLimits('0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', OPERATOR_B),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('holds a mixed request as a whole: its lowered value waits too, so nothing is partly applied', async () => {
    const h = await harness();
    const outcome = await h.service.setLimits(
      { perPaymentMinor: 50_000, dailyTotalMinor: 2_000_000 },
      OPERATOR_A,
    );
    expect(outcome.applied).toBe(false);
    expect(h.service.currentLimits().perPaymentMinor).toBe(h.config.initialLimits.perPaymentMinor);
  });

  it('closes a waiting raise when a lower limit is applied, so the raise cannot undo it later', async () => {
    const h = await harness();
    const raised = await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    if (raised.applied) {
      throw new Error('a raised limit must wait for approval');
    }
    const lowered = await h.service.setLimits({ perPaymentMinor: 50_000 }, OPERATOR_B);
    expect(lowered).toMatchObject({ applied: true });
    expect(h.service.opsOverview().pendingLimitChange).toBeNull();
    await expect(h.service.approveLimits(raised.requestId, OPERATOR_B)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.service.currentLimits().perPaymentMinor).toBe(50_000);
    expect(h.log.events()).toContainEqual(
      expect.objectContaining({
        type: 'limits.expired',
        requestId: raised.requestId,
        reason: 'superseded',
      }),
    );
  });

  it('lets a raise lapse after the window, and records the lapse', async () => {
    const h = await harness();
    const outcome = await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    if (outcome.applied) {
      throw new Error('a raised limit must wait for approval');
    }
    h.clock.now = new Date(h.clock.now.getTime() + LIMIT_INCREASE_WINDOW_MS + 1_000);
    await expect(h.service.approveLimits(outcome.requestId, OPERATOR_B)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.service.opsOverview().pendingLimitChange).toBeNull();
    expect(h.log.events()).toContainEqual(
      expect.objectContaining({
        type: 'limits.expired',
        requestId: outcome.requestId,
        reason: 'expired',
      }),
    );
    expect(h.service.currentLimits().perPaymentMinor).toBe(h.config.initialLimits.perPaymentMinor);
    const again = await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    expect(again.applied).toBe(false);
  });

  it('keeps proposals on the current policy while a raise waits', async () => {
    const h = await harness();
    await activeSupplier(h);
    await h.service.setLimits({ perPaymentMinor: 2_000_000 }, OPERATOR_A);
    const reply = await h.service.propose(
      proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now),
    );
    expect(reply.decision.policyVersion).toBe(h.config.policyVersion);
    expect(reply.toCoSign).not.toBeNull();
    await h.service.coSign(
      reply.attemptId ?? '',
      coSignAsAgent(h.base.agentWallet, reply.toCoSign ?? ''),
    );
  });

  it('rebuilds a waiting raise and its approval from the event log alone', async () => {
    const h = await harness();
    const outcome = await h.service.setLimits({ perPaymentMinor: 200_000 }, OPERATOR_A);
    if (outcome.applied) {
      throw new Error('a raised limit must wait for approval');
    }
    const restarted = await openService(h.base, h.config, evidenceFrom([STANDARD]), {
      clock: h.clock,
      log: h.log,
    });
    expect(restarted.opsOverview().pendingLimitChange?.requestId).toBe(outcome.requestId);
    await restarted.approveLimits(outcome.requestId, OPERATOR_B);
    const reopened = await openService(h.base, h.config, evidenceFrom([STANDARD]), {
      clock: h.clock,
      log: h.log,
    });
    expect(reopened.currentLimits().perPaymentMinor).toBe(200_000);
    expect(reopened.opsOverview().pendingLimitChange).toBeNull();
  });
});

describe('limit changes over HTTP', () => {
  it('returns a held raise to the first operator, and applies it when the second approves', async () => {
    const h = await harness();
    const asked = await post(
      h,
      '/v1/policy/limits',
      { perPaymentMinor: 200_000 },
      OPERATOR_A,
      OPERATOR_A_SECRET,
    );
    expect(asked.status).toBe(200);
    const pending = (await asked.json()) as {
      readonly applied: boolean;
      readonly requestId: string;
    };
    expect(pending.applied).toBe(false);
    const approval = await post(
      h,
      `/v1/policy/limits/${pending.requestId}/approve`,
      undefined,
      OPERATOR_B,
      OPERATOR_B_SECRET,
    );
    expect(approval.status).toBe(200);
    expect(h.service.currentLimits().perPaymentMinor).toBe(200_000);
  });

  it('refuses an agent principal and an unsigned request on both limit routes', async () => {
    const h = await harness();
    const agent = await post(h, '/v1/policy/limits', { perPaymentMinor: 1 }, AGENT, AGENT_SECRET);
    expect(agent.status).toBe(401);
    const unsigned = await fetch(new URL('/v1/policy/limits', h.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unsigned.status).toBe(401);
    const approval = await post(
      h,
      `/v1/policy/limits/${newAttemptId()}/approve`,
      undefined,
      AGENT,
      AGENT_SECRET,
    );
    expect(approval.status).toBe(401);
  });

  it('answers an approval of a malformed id as no route at all', async () => {
    const h = await harness();
    const response = await post(
      h,
      '/v1/policy/limits/not-an-id/approve',
      undefined,
      OPERATOR_B,
      OPERATOR_B_SECRET,
    );
    expect(response.status).toBe(404);
  });
});
