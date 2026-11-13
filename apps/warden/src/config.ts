import { readFileSync } from 'node:fs';
import { isValidClassicAddress } from 'xrpl';
import { z } from 'zod';

import {
  CurrencyCode,
  PayableMinorUnits,
  PolicyVersion,
  SchemaVersion,
} from '../../../packages/shared/src/schemas/index.js';

import type { Principal } from './auth.js';

/**
 * Configuration the Warden starts from. Nothing here is a secret: addresses and limits are public or
 * operator-owned facts. Secrets live in the separate keys file, which only the Warden process reads.
 */

const ClassicAddress = z
  .string()
  .refine((value) => isValidClassicAddress(value), 'not a classic address');

/** A payable currency and the ledger asset that pays it. */
const AssetEntry = z.strictObject({
  currency: CurrencyCode,
  ledgerCurrency: z.string().min(3).max(40),
  issuer: ClassicAddress,
});

export const WardenConfigFile = z.strictObject({
  schemaVersion: SchemaVersion,
  buyerScope: z.string().min(1).max(64),
  policyVersion: PolicyVersion,
  /** The asset the Warden pays by default. Paying any other asset needs two operator approvals. */
  expectedAsset: AssetEntry,
  alternateAssets: z.array(AssetEntry).max(10),
  spendingAddress: ClassicAddress,
  agentAddress: ClassicAddress,
  wardenAddress: ClassicAddress,
  coolingOffHours: z.number().min(0).max(720),
  matchTolerance: z.strictObject({
    absoluteMinor: z.int().min(0).max(1_000_000_000),
    basisPoints: z.int().min(0).max(10_000),
  }),
  limits: z.strictObject({
    perPaymentMinor: PayableMinorUnits,
    supplierDailyMinor: PayableMinorUnits,
    dailyTotalMinor: PayableMinorUnits,
  }),
  submission: z.strictObject({
    pollMs: z.int().min(0).max(60_000),
    maxPolls: z.int().min(1).max(1_000),
  }),
  listen: z.strictObject({
    host: z.string().min(1).max(255),
    port: z.int().min(1).max(65_535),
  }),
  verifiedPayees: z.array(ClassicAddress).max(1000),
  /** The buyer's permissioned domain: a supplier must hold a credential it accepts. Absent means no credential check. */
  supplierDomain: z
    .strictObject({ owner: ClassicAddress, sequence: z.int().min(1).max(4_294_967_295) })
    .optional(),
});
export type WardenConfigFile = z.infer<typeof WardenConfigFile>;

/** A ledger asset, with the payable currency it pays. */
export interface AssetDefinition {
  readonly currency: z.infer<typeof CurrencyCode>;
  readonly ledgerCurrency: string;
  readonly issuer: string;
}

/** The resolved configuration the service uses, with durations in milliseconds. */
export interface WardenConfig {
  readonly buyerScope: string;
  readonly policyVersion: string;
  readonly expectedAsset: AssetDefinition;
  readonly alternateAssets: readonly AssetDefinition[];
  readonly spendingAddress: string;
  readonly agentAddress: string;
  readonly wardenAddress: string;
  readonly coolingOffMs: number;
  readonly matchTolerance: { readonly absoluteMinor: number; readonly basisPoints: number };
  readonly initialLimits: {
    readonly perPaymentMinor: number;
    readonly supplierDailyMinor: number;
    readonly dailyTotalMinor: number;
  };
  readonly submission: { readonly pollMs: number; readonly maxPolls: number };
  readonly listen: { readonly host: string; readonly port: number };
  readonly verifiedPayees: readonly string[];
  readonly supplierDomain: { readonly owner: string; readonly sequence: number } | null;
}

export function resolveConfig(file: WardenConfigFile): WardenConfig {
  return {
    buyerScope: file.buyerScope,
    policyVersion: file.policyVersion,
    expectedAsset: file.expectedAsset,
    alternateAssets: file.alternateAssets,
    spendingAddress: file.spendingAddress,
    agentAddress: file.agentAddress,
    wardenAddress: file.wardenAddress,
    coolingOffMs: file.coolingOffHours * 60 * 60 * 1000,
    matchTolerance: file.matchTolerance,
    initialLimits: file.limits,
    submission: file.submission,
    listen: file.listen,
    verifiedPayees: file.verifiedPayees,
    supplierDomain: file.supplierDomain ?? null,
  };
}

/** Reads the configuration. A missing or invalid file stops the Warden: it never starts on guessed rules. */
export function loadConfig(path: string): WardenConfig {
  // The configuration file is the operator's, read once at start-up.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return resolveConfig(WardenConfigFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown));
}

const Base64Secret = z.string().min(40).max(200);

export const KeysFile = z.strictObject({
  schemaVersion: SchemaVersion,
  wardenSeed: z.string().regex(/^s[1-9A-HJ-NP-Za-km-z]{20,40}$/),
  principals: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        role: z.enum(['agent', 'operator']),
        secret: Base64Secret,
      }),
    )
    .min(1),
});
export type KeysFile = z.infer<typeof KeysFile>;

/** The Warden's own seed and the callers' request secrets. Only the Warden process reads this file. */
export interface LoadedKeys {
  readonly wardenSeed: string;
  readonly principals: ReadonlyMap<string, Principal>;
}

export function loadKeys(path: string): LoadedKeys {
  // The keys file is in the Warden's private local directory and is read once at start-up.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const file = KeysFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const principals = new Map<string, Principal>();
  for (const entry of file.principals) {
    const secret = Buffer.from(entry.secret, 'base64');
    if (secret.length < 32 || principals.has(entry.id)) {
      throw new Error('the keys file has a weak or repeated principal secret');
    }
    principals.set(entry.id, { id: entry.id, role: entry.role, secret });
  }
  return { wardenSeed: file.wardenSeed, principals };
}
