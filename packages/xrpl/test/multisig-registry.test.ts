import { describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';
import {
  assertSignedExactly,
  combineSigned,
  hashOfSigned,
  signAsSigner,
  signerAccounts,
} from '../src/multisig.js';
import { buildXrpPayment } from '../src/transactions.js';
import {
  activeAccount,
  accountsWithRole,
  emptyRegistry,
  registrySchema,
  withAccount,
  type RegistryAccount,
} from '../src/registry.js';

/** A family seed built at run time, so no secret-shaped literal is written into the source. */
function freshSeed(): string {
  const { seed } = Wallet.generate();
  if (seed === undefined) {
    throw new Error('xrpl generated a wallet without a seed');
  }
  return seed;
}

const SEED = freshSeed();
const ADDRESS = 'rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const NOW = '2026-11-10T10:00:00.000Z';

function account(
  role: RegistryAccount['role'],
  address: string,
  status: RegistryAccount['status'] = 'active',
): RegistryAccount {
  return { role, address, status, createdAt: NOW };
}

describe('multi-signing helpers', () => {
  it('combines two signatures into one blob that carries exactly those two signers', () => {
    const first = Wallet.generate();
    const second = Wallet.generate();
    const tx = buildXrpPayment(first.address, second.address, '1000');
    const prepared = { ...tx, Sequence: 1, Fee: '30', LastLedgerSequence: 100, SigningPubKey: '' };
    const blob = combineSigned([signAsSigner(first, prepared), signAsSigner(second, prepared)]);
    expect(signerAccounts(blob)).toEqual([first.address, second.address].sort());
    expect(() => {
      assertSignedExactly(blob, [first.address, second.address]);
    }).not.toThrow();
    expect(() => {
      assertSignedExactly(blob, [first.address]);
    }).toThrow('exactly the required signers');
    expect(() => {
      assertSignedExactly(blob, [first.address, second.address, 'rX']);
    }).toThrow('exactly the required signers');
  });

  it('reports no signers for a blob that was never multi-signed', () => {
    const wallet = Wallet.generate();
    const destination = Wallet.generate();
    const tx = buildXrpPayment(wallet.address, destination.address, '1000');
    const prepared = { ...tx, Sequence: 1, Fee: '10', LastLedgerSequence: 100 };
    expect(signerAccounts(wallet.sign(prepared).tx_blob)).toEqual([]);
  });

  it('refuses to combine nothing', () => {
    expect(() => combineSigned([])).toThrow('nothing to combine');
  });

  it('hashes a signed blob deterministically, so the hash is known before submission', () => {
    const wallet = Wallet.generate();
    const destination = Wallet.generate();
    const tx = buildXrpPayment(wallet.address, destination.address, '1000');
    const blob = wallet.sign({ ...tx, Sequence: 1, Fee: '10', LastLedgerSequence: 100 }).tx_blob;
    expect(hashOfSigned(blob)).toMatch(/^[0-9A-F]{64}$/);
    expect(hashOfSigned(blob)).toBe(hashOfSigned(blob));
  });
});

describe('registry schema', () => {
  const entry = {
    role: 'spending',
    address: ADDRESS,
    seed: SEED,
    status: 'active',
    createdAt: NOW,
  };
  const valid = { schema: 1, network: 'testnet', accounts: [entry] };

  it('accepts a well-formed testnet registry', () => {
    expect(registrySchema.parse(valid).accounts.length).toBe(1);
  });

  it('refuses a bad address, a bad seed, an unknown field, a wrong network and a wrong status', () => {
    expect(() =>
      registrySchema.parse({ ...valid, accounts: [{ ...entry, address: 'notAnAddress' }] }),
    ).toThrow();
    expect(() =>
      registrySchema.parse({ ...valid, accounts: [{ ...entry, seed: 'notASeed' }] }),
    ).toThrow();
    expect(() => registrySchema.parse({ ...valid, extra: true })).toThrow();
    expect(() => registrySchema.parse({ ...valid, network: 'mainnet' })).toThrow();
    expect(() =>
      registrySchema.parse({ ...valid, accounts: [{ ...entry, status: 'closed' }] }),
    ).toThrow();
  });

  it('accepts an account whose seed has been removed', () => {
    const removed = {
      schema: 1,
      network: 'testnet',
      accounts: [{ role: 'spending', address: ADDRESS, status: 'master-disabled', createdAt: NOW }],
    };
    expect(() => registrySchema.parse(removed)).not.toThrow();
  });
});

describe('registry helpers', () => {
  it('finds the one account in use for a role and ignores abandoned ones', () => {
    const registry = {
      ...emptyRegistry(),
      accounts: [account('spending', 'rOld1', 'abandoned'), account('spending', 'rNew1')],
    };
    expect(accountsWithRole(registry, 'spending').length).toBe(2);
    expect(activeAccount(registry, 'spending')?.address).toBe('rNew1');
    expect(activeAccount(registry, 'agent')).toBeUndefined();
  });

  it('refuses two accounts in use for the same role', () => {
    const registry = {
      ...emptyRegistry(),
      accounts: [account('spending', 'rA1'), account('spending', 'rB1')],
    };
    expect(() => activeAccount(registry, 'spending')).toThrow('more than one account');
  });

  it('adds an account, or replaces the one with the same address', () => {
    const base = { ...emptyRegistry(), accounts: [account('agent', 'rAgent1')] };
    const replaced = withAccount(base, { ...account('agent', 'rAgent1'), status: 'abandoned' });
    expect(replaced.accounts.length).toBe(1);
    expect(replaced.accounts[0]?.status).toBe('abandoned');
    expect(withAccount(base, account('warden', 'rWarden1')).accounts.length).toBe(2);
  });
});
