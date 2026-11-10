import { existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

/**
 * The console's operator accounts. A file lists each person, their role, their password hash and, for an operator, the
 * Warden principal and secret that the console uses on that person's behalf. A person has their own Warden principal,
 * so two approvals really are two people. The file lives in the operator's private folder, never in the repository.
 */

export const ROLES = ['viewer', 'operator'] as const;
export type Role = (typeof ROLES)[number];

export interface Operator {
  readonly username: string;
  readonly role: Role;
  readonly passwordHash: string;
  readonly wardenPrincipal: string | null;
  readonly wardenSecret: Buffer | null;
}

export interface OperatorStore {
  find(username: string): Operator | undefined;
  readonly size: number;
}

const Username = z.string().regex(/^[a-z][a-z0-9._-]{2,31}$/);
const PrincipalId = z.string().regex(/^[a-z][a-z0-9._-]{2,63}$/);
/** A base64 secret of at least 32 bytes. */
const SecretText = z.string().min(44).max(200);

const OperatorRecord = z
  .strictObject({
    username: Username,
    role: z.enum(ROLES),
    passwordHash: z.string().startsWith('scrypt$').max(300),
    wardenPrincipal: PrincipalId.nullable(),
    wardenSecret: SecretText.nullable(),
  })
  .superRefine((record, context) => {
    const hasPrincipal = record.wardenPrincipal !== null && record.wardenSecret !== null;
    const noPrincipal = record.wardenPrincipal === null && record.wardenSecret === null;
    if (record.role === 'operator' && !hasPrincipal) {
      context.addIssue({
        code: 'custom',
        message: 'an operator needs a Warden principal and secret',
      });
    }
    if (record.role === 'viewer' && !noPrincipal) {
      context.addIssue({ code: 'custom', message: 'a viewer has no Warden principal' });
    }
  });

const OperatorFile = z.strictObject({
  schemaVersion: z.literal(1),
  operators: z.array(OperatorRecord).max(100),
});

/** The store from already-parsed records. A duplicate username is refused, so one name cannot mean two people. */
export function operatorStoreOf(records: readonly unknown[]): OperatorStore {
  const parsed = z.array(OperatorRecord).parse(records);
  const byName = new Map<string, Operator>();
  for (const record of parsed) {
    const key = record.username;
    if (byName.has(key)) {
      throw new Error('the operator file names one username twice');
    }
    byName.set(key, {
      username: record.username,
      role: record.role,
      passwordHash: record.passwordHash,
      wardenPrincipal: record.wardenPrincipal,
      wardenSecret:
        record.wardenSecret === null ? null : Buffer.from(record.wardenSecret, 'base64'),
    });
  }
  return {
    find: (username) => byName.get(username.toLowerCase()),
    size: byName.size,
  };
}

/** One operator as the file stores it. */
export interface OperatorInput {
  readonly username: string;
  readonly role: Role;
  readonly passwordHash: string;
  readonly wardenPrincipal: string | null;
  readonly wardenSecret: string | null;
}

/**
 * The records with one operator added, or replaced when the username is already there. The result is validated before it
 * is returned, so a record that would not load is refused here rather than at the next start-up.
 */
export function upsertOperator(
  records: readonly OperatorInput[],
  next: OperatorInput,
): OperatorInput[] {
  const wanted = next.username.toLowerCase();
  const updated = [...records.filter((record) => record.username.toLowerCase() !== wanted), next];
  operatorStoreOf(updated);
  return updated;
}

/** Reads the operator file. A missing file gives an empty store, so nobody can sign in (fail closed). */
export function loadOperators(path: string): OperatorStore {
  // The path is the operator's own private file, read once at start-up.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own file, read once at start-up
  if (!existsSync(path)) {
    return operatorStoreOf([]);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own file, read once at start-up
  const file = OperatorFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  return operatorStoreOf(file.operators);
}
