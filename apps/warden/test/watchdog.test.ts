import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestVerifier, signatureFor, signingText, type Principal } from '../src/auth.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { memoryEventLog } from '../src/events.js';
import { createWardenServer } from '../src/server.js';
import {
  WATCHDOG_WINDOW_MS,
  WardenError,
  type WardenService,
  startWatchdogTimer,
} from '../src/service.js';
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

/*
 * The watchdog: an armed Warden pauses itself when no operator heartbeat arrives within the window, and only an
 * operator's resume lets payments continue again. The secrets are generated for each run, so no secret-looking
 * literal is written into this file.
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

interface Harness {
  readonly base: Base;
  readonly clock: Clock;
  readonly config: ReturnType<typeof configFor>;
  readonly service: WardenService;
  readonly log: ReturnType<typeof memoryEventLog>;
}

/** An active supplier, enrolled by one operator and approved by a second, as the operator process does. */
async function harness(): Promise<Harness> {
  const base = await provisionedBase();
  const config = configFor(base);
  const clock = newClock();
  const log = memoryEventLog();
  const service = await openService(base, config, evidenceFrom([STANDARD]), { clock, log });
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: base.supplierAccount.address, destinationTag: null },
      publicKey: generateSupplierKey().publicKey,
    },
    OPERATOR_A,
  );
  await service.approveSupplier(SUPPLIER, OPERATOR_B);
  return { base, clock, config, service, log };
}

function advance(h: Harness, ms: number): void {
  h.clock.now = new Date(h.clock.now.getTime() + ms);
}

function proposeStandard(h: Harness) {
  return h.service.propose(proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now));
}

describe('the watchdog', () => {
  it('does nothing while the Warden is not armed', async () => {
    const h = await harness();
    advance(h, 10 * WATCHDOG_WINDOW_MS);
    expect((await proposeStandard(h)).decision.decision).toBe('ALLOW');
  });

  it('pauses an armed Warden that hears no heartbeat in time, and records that the watchdog did it', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS + 1_000);
    const held = await proposeStandard(h);
    expect(held.decision.decision).toBe('HOLD');
    expect(held.decision.reasons[0]?.code).toBe('PAUSED');
    expect(h.log.events()).toContainEqual(
      expect.objectContaining({ type: 'pause.set', paused: true, changedBy: 'watchdog' }),
    );
  });

  it('records the pause on its own check, with no request arriving', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS + 1);
    expect(h.log.events()).not.toContainEqual(expect.objectContaining({ changedBy: 'watchdog' }));
    await h.service.checkWatchdog();
    expect(h.service.health().paused).toBe(true);
    expect(h.log.events()).toContainEqual(
      expect.objectContaining({ type: 'pause.set', paused: true, changedBy: 'watchdog' }),
    );
  });

  it('does not pause on its own check while the window is still open', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS);
    await h.service.checkWatchdog();
    expect(h.service.health().paused).toBe(false);
  });

  it('runs the check on a timer and stops when asked', async () => {
    vi.useFakeTimers();
    try {
      let checks = 0;
      const stop = startWatchdogTimer(
        {
          checkWatchdog: () => {
            checks += 1;
            return Promise.resolve();
          },
        },
        () => undefined,
        1_000,
      );
      await vi.advanceTimersByTimeAsync(3_500);
      expect(checks).toBe(3);
      stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(checks).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed timer check and keeps checking', async () => {
    vi.useFakeTimers();
    try {
      const errors: unknown[] = [];
      let checks = 0;
      const stop = startWatchdogTimer(
        {
          checkWatchdog: () => {
            checks += 1;
            return Promise.reject(new Error('disk full'));
          },
        },
        (error) => errors.push(error),
        1_000,
      );
      await vi.advanceTimersByTimeAsync(2_500);
      stop();
      expect(checks).toBe(2);
      expect(errors).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an armed Warden running while heartbeats arrive inside the window', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS - 5_000);
    await h.service.heartbeat();
    advance(h, WATCHDOG_WINDOW_MS - 5_000);
    expect((await proposeStandard(h)).decision.decision).toBe('ALLOW');
  });

  it('does not erase an expired window when the first activity is a late heartbeat', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS + 1);
    await h.service.heartbeat();
    expect(h.service.health().paused).toBe(true);
    expect(h.log.events()).toContainEqual(
      expect.objectContaining({ type: 'pause.set', paused: true, changedBy: 'watchdog' }),
    );
    expect((await proposeStandard(h)).decision.decision).toBe('HOLD');
    await h.service.setPaused(false, OPERATOR_A);
    expect((await proposeStandard(h)).decision.decision).toBe('ALLOW');
  });

  it('is not resumed by a heartbeat: only an operator resume lets payments through again', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS + 1_000);
    await proposeStandard(h);
    await h.service.heartbeat();
    expect((await proposeStandard(h)).decision.decision).toBe('HOLD');
    await h.service.setPaused(false, OPERATOR_A);
    expect((await proposeStandard(h)).decision.decision).toBe('ALLOW');
  });

  it('refuses a co-signature once the window has lapsed, even when the proposal was made in time', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    const attemptId = newAttemptId();
    const reply = await h.service.propose(proposalFor(attemptId, STANDARD, h.config, h.clock.now));
    expect(reply.toCoSign).not.toBeNull();
    advance(h, WATCHDOG_WINDOW_MS + 1_000);
    const agentBlob = coSignAsAgent(h.base.agentWallet, reply.toCoSign ?? '');
    await expect(h.service.coSign(attemptId, agentBlob)).rejects.toThrow(WardenError);
    await expect(h.service.coSign(attemptId, agentBlob)).rejects.toThrow('paused');
    expect(h.service.attempt(attemptId)?.status).toBe('awaiting');
    expect(h.service.health().paused).toBe(true);
  });

  it('stops watching when it is disarmed', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    await h.service.setArmed(false, OPERATOR_A);
    advance(h, 10 * WATCHDOG_WINDOW_MS);
    expect((await proposeStandard(h)).decision.decision).toBe('ALLOW');
  });

  it('keeps the watchdog pause and the armed state after a restart, from the event log alone', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    advance(h, WATCHDOG_WINDOW_MS + 1_000);
    await proposeStandard(h);
    const restarted = await openService(h.base, h.config, evidenceFrom([STANDARD]), {
      clock: h.clock,
      log: h.log,
    });
    expect(restarted.health().paused).toBe(true);
  });

  it('starts an armed Warden paused after a restart, until an operator heartbeat and resume', async () => {
    const h = await harness();
    await h.service.setArmed(true, OPERATOR_A);
    const restarted = await openService(h.base, h.config, evidenceFrom([STANDARD]), {
      clock: h.clock,
      log: h.log,
    });
    expect(restarted.health().paused).toBe(true);
    expect(h.log.events()).toContainEqual(
      expect.objectContaining({ type: 'pause.set', paused: true, changedBy: 'watchdog' }),
    );
    const before = await restarted.propose(
      proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now),
    );
    expect(before.decision.decision).toBe('HOLD');
    await restarted.heartbeat();
    await restarted.setPaused(false, OPERATOR_A);
    const after = await restarted.propose(
      proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now),
    );
    expect(after.decision.decision).toBe('ALLOW');
  });
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

/** A signed POST with no body. The response body is read so the connection closes cleanly. */
async function signedPost(
  url: string,
  path: string,
  principal: string,
  secret: Buffer,
  at: Date,
): Promise<number> {
  const timestamp = at.toISOString();
  const nonce = randomBytes(16).toString('hex');
  const response = await fetch(new URL(path, url), {
    method: 'POST',
    headers: {
      'x-signoff-principal': principal,
      'x-signoff-timestamp': timestamp,
      'x-signoff-nonce': nonce,
      'x-signoff-signature': signatureFor(secret, signingText('POST', path, timestamp, nonce, '')),
    },
  });
  await response.text();
  return response.status;
}

describe('the watchdog over HTTP', () => {
  it('lets operators arm, heartbeat, resume and disarm; refuses an agent; and pauses a lapsed Warden', async () => {
    const h = await harness();
    const verifier = new RequestVerifier(PRINCIPALS, () => h.clock.now, START.getTime());
    const url = await listen(createWardenServer(h.service, verifier, () => undefined));
    const now = (): Date => h.clock.now;

    expect(await signedPost(url, '/v1/control/arm', AGENT, AGENT_SECRET, now())).toBe(401);
    expect(await signedPost(url, '/v1/control/arm', OPERATOR_A, OPERATOR_A_SECRET, now())).toBe(
      200,
    );
    expect(await signedPost(url, '/v1/control/heartbeat', AGENT, AGENT_SECRET, now())).toBe(401);
    expect(await signedPost(url, '/v1/control/resume', AGENT, AGENT_SECRET, now())).toBe(401);

    advance(h, WATCHDOG_WINDOW_MS + 1_000);
    const held = await proposeStandard(h);
    expect(held.decision.reasons[0]?.code).toBe('PAUSED');

    expect(
      await signedPost(url, '/v1/control/heartbeat', OPERATOR_A, OPERATOR_A_SECRET, now()),
    ).toBe(200);
    expect(await signedPost(url, '/v1/control/resume', OPERATOR_A, OPERATOR_A_SECRET, now())).toBe(
      200,
    );
    expect((await proposeStandard(h)).decision.decision).toBe('ALLOW');
    expect(await signedPost(url, '/v1/control/disarm', OPERATOR_A, OPERATOR_A_SECRET, now())).toBe(
      200,
    );
  });

  it('records a pause if an authenticated heartbeat arrives after expiry before any proposal', async () => {
    const h = await harness();
    const verifier = new RequestVerifier(PRINCIPALS, () => h.clock.now, START.getTime());
    const url = await listen(createWardenServer(h.service, verifier, () => undefined));
    const now = (): Date => h.clock.now;
    expect(await signedPost(url, '/v1/control/arm', OPERATOR_A, OPERATOR_A_SECRET, now())).toBe(
      200,
    );
    advance(h, WATCHDOG_WINDOW_MS + 1);
    expect(
      await signedPost(url, '/v1/control/heartbeat', OPERATOR_A, OPERATOR_A_SECRET, now()),
    ).toBe(200);
    expect(h.service.health().paused).toBe(true);
    expect((await proposeStandard(h)).decision.decision).toBe('HOLD');
  });
});
