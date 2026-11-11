import { z } from 'zod';

/** The roles in a SignOff payment setup. Each role is one account on the testnet. */
export const ROLES = ['spending', 'reserve', 'supplier', 'agent', 'warden', 'issuer'] as const;
export type Role = (typeof ROLES)[number];

const classicAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
const familySeed = z.string().regex(/^s[1-9A-HJ-NP-Za-km-z]{20,40}$/);

/**
 * One account in the local registry. The registry lives outside the repository. A seed is present
 * only while the account still needs it: the spending account's master seed is removed once the
 * master key is disabled on the ledger.
 */
export const registryAccountSchema = z.strictObject({
  role: z.enum(ROLES),
  address: classicAddress,
  seed: familySeed.optional(),
  status: z.enum(['active', 'master-disabled', 'abandoned']),
  createdAt: z.iso.datetime(),
});

export const registrySchema = z.strictObject({
  schema: z.literal(1),
  network: z.literal('testnet'),
  accounts: z.array(registryAccountSchema),
});

export type RegistryAccount = z.infer<typeof registryAccountSchema>;
export type Registry = z.infer<typeof registrySchema>;

export function emptyRegistry(): Registry {
  return { schema: 1, network: 'testnet', accounts: [] };
}

/** Every account with this role, in creation order (a rebuild adds a second spending account). */
export function accountsWithRole(registry: Registry, role: Role): RegistryAccount[] {
  return registry.accounts.filter((account) => account.role === role);
}

/** The one account in use for a role. Abandoned accounts are ignored; two in-use accounts is an error. */
export function activeAccount(registry: Registry, role: Role): RegistryAccount | undefined {
  const inUse = accountsWithRole(registry, role).filter(
    (account) => account.status !== 'abandoned',
  );
  if (inUse.length > 1) {
    throw new Error(`more than one account is in use for the ${role} role`);
  }
  return inUse[0];
}

/** Returns a copy of the registry with the account added, or replaced when its address is known. */
export function withAccount(registry: Registry, account: RegistryAccount): Registry {
  const others = registry.accounts.filter((existing) => existing.address !== account.address);
  return { ...registry, accounts: [...others, account] };
}
