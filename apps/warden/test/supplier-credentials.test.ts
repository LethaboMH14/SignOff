import { describe, expect, it } from 'vitest';

import {
  credentialTypeHex,
  type CredentialTypeRef,
} from '../../../packages/xrpl/src/credentials.js';
import type { LedgerPort } from '../../../packages/xrpl/src/port.js';
import { coSignAsAgent, generateSupplierKey } from '../src/client.js';
import { WardenError } from '../src/service.js';
import {
  configFor,
  evidenceFrom,
  newAttemptId,
  newClock,
  openService,
  provisionedBase,
  proposalFor,
  STANDARD,
  SUPPLIER,
  type Base,
} from './helpers/world.js';

/*
 * The supplier credential rule: a supplier is paid only when it holds an accepted credential that the buyer's
 * permissioned domain lists. The ledger is simulated here through the optional port methods; the reads that talk to
 * a real node are checked on Testnet, not in this file.
 */

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';
const CREDENTIAL = credentialTypeHex('KYB-APPROVED');

interface SimulatedLedger {
  /** Keys of the form subject|issuer|credentialType, for each credential the subject has accepted. */
  readonly accepted: Set<string>;
  domain: readonly CredentialTypeRef[] | null;
  readCredentials: boolean;
  readDomain: boolean;
  readonly domainQueries: [string, number][];
}

function newSimulatedLedger(): SimulatedLedger {
  return {
    accepted: new Set<string>(),
    domain: [],
    readCredentials: true,
    readDomain: true,
    domainQueries: [],
  };
}

function withCredentials(base: Base, ledger: SimulatedLedger): LedgerPort {
  return {
    ...base.port,
    credentialAccepted: (subject: string, issuer: string, credentialType: string) => {
      if (!ledger.readCredentials) {
        return Promise.reject(new Error('the credential could not be read'));
      }
      return Promise.resolve(ledger.accepted.has(`${subject}|${issuer}|${credentialType}`));
    },
    permissionedDomainAccepts: (owner: string, sequence: number) => {
      ledger.domainQueries.push([owner, sequence]);
      if (!ledger.readDomain) {
        return Promise.reject(new Error('the domain could not be read'));
      }
      return Promise.resolve(ledger.domain);
    },
  };
}

interface Harness {
  readonly base: Base;
  readonly config: ReturnType<typeof configFor>;
  readonly clock: ReturnType<typeof newClock>;
  readonly service: Awaited<ReturnType<typeof openService>>;
}

/** An approved supplier, with the buyer's domain switched on or off, and the ledger it reads from. */
async function harness(
  ledger: SimulatedLedger,
  options: { domain: boolean; port?: LedgerPort },
): Promise<Harness> {
  const base = await provisionedBase();
  const config = configFor(
    base,
    options.domain ? { supplierDomain: { owner: base.warden.address, sequence: 7 } } : {},
  );
  const clock = newClock();
  const service = await openService(base, config, evidenceFrom([STANDARD]), {
    clock,
    port: options.port ?? withCredentials(base, ledger),
  });
  await service.enrolSupplier(
    {
      supplierId: SUPPLIER,
      payee: { address: base.supplierAccount.address, destinationTag: null },
      publicKey: generateSupplierKey().publicKey,
    },
    OPERATOR_A,
  );
  await service.approveSupplier(SUPPLIER, OPERATOR_B);
  return { base, config, clock, service };
}

function domainOf(h: Harness, ledger: SimulatedLedger, types: string[] = [CREDENTIAL]): void {
  ledger.domain = types.map((credentialType) => ({
    issuer: h.base.warden.address,
    credentialType,
  }));
}

function acceptCredential(
  h: Harness,
  ledger: SimulatedLedger,
  issuer = h.base.warden.address,
): void {
  ledger.accepted.add(`${h.base.supplierAccount.address}|${issuer}|${CREDENTIAL}`);
}

function propose(h: Harness) {
  return h.service.propose(proposalFor(newAttemptId(), STANDARD, h.config, h.clock.now));
}

describe('the supplier credential rule', () => {
  it('pays a supplier that holds an accepted credential from the buyer domain', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    domainOf(h, ledger);
    acceptCredential(h, ledger);
    const reply = await propose(h);
    expect(reply.decision.decision).toBe('ALLOW');
  });

  it('reads the domain the buyer configured, by its owner and sequence number', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    domainOf(h, ledger);
    acceptCredential(h, ledger);
    await propose(h);
    expect(ledger.domainQueries).toContainEqual([h.base.warden.address, 7]);
  });

  it('holds a payment to a supplier with no accepted credential', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    domainOf(h, ledger);
    const reply = await propose(h);
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('SUPPLIER_CREDENTIAL_MISSING');
    expect(reply.toCoSign).toBeNull();
  });

  it('does not count a credential from an issuer the domain does not list', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    domainOf(h, ledger);
    acceptCredential(h, ledger, h.base.issuer.address);
    const reply = await propose(h);
    expect(reply.decision.reasons[0]?.code).toBe('SUPPLIER_CREDENTIAL_MISSING');
  });

  it('holds a payment when the buyer domain is not on the ledger', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    ledger.domain = null;
    acceptCredential(h, ledger);
    const reply = await propose(h);
    expect(reply.decision.reasons[0]?.code).toBe('SUPPLIER_CREDENTIAL_MISSING');
  });

  it('holds rather than pays when a credential cannot be read', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    domainOf(h, ledger);
    acceptCredential(h, ledger);
    ledger.readCredentials = false;
    const reply = await propose(h);
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('LEDGER_UNREADABLE');
  });

  it('holds rather than pays when the domain cannot be read', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    ledger.readDomain = false;
    const reply = await propose(h);
    expect(reply.decision.reasons[0]?.code).toBe('LEDGER_UNREADABLE');
  });

  it('holds when this ledger connection cannot read credentials at all', async () => {
    const ledger = newSimulatedLedger();
    const bare = await provisionedBase();
    const h = await harness(ledger, { domain: true, port: bare.port });
    const reply = await propose(h);
    expect(reply.decision.decision).toBe('HOLD');
    expect(reply.decision.reasons[0]?.code).toBe('LEDGER_UNREADABLE');
  });

  it('does nothing when no domain is configured, so existing buyers are unchanged', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: false });
    const reply = await propose(h);
    expect(reply.decision.decision).toBe('ALLOW');
    expect(ledger.domainQueries).toHaveLength(0);
  });

  it('refuses the second signature when the credential is revoked after the proposal', async () => {
    const ledger = newSimulatedLedger();
    const h = await harness(ledger, { domain: true });
    domainOf(h, ledger);
    acceptCredential(h, ledger);
    const attemptId = newAttemptId();
    const reply = await h.service.propose(proposalFor(attemptId, STANDARD, h.config, h.clock.now));
    expect(reply.decision.decision).toBe('ALLOW');
    ledger.accepted.clear();
    const agentBlob = coSignAsAgent(h.base.agentWallet, reply.toCoSign ?? '');
    await expect(h.service.coSign(attemptId, agentBlob)).rejects.toThrow(WardenError);
    await expect(h.service.coSign(attemptId, agentBlob)).rejects.toThrow('no longer holds');
    expect(h.service.attempt(attemptId)?.status).toBe('awaiting');
  });
});
