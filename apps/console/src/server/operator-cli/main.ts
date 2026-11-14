import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertOutsideRepository, defaultLocalDir } from '../../../../../packages/xrpl/src/node.js';
import { type OperatorInput, ROLES, type Role, upsertOperator } from '../auth/operators.js';
import { hashPassword, passwordProblem } from '../auth/passwords.js';

/**
 * Adds or replaces a console operator. Run from the repository root:
 *
 *   npm run console:operator -- add <username> <operator|viewer> [--principal <id>] [--secret-file <path>]
 *                               [--password-file <path>] [--file <path>]
 *   npm run console:operator -- list [--file <path>]
 *
 * The password comes from --password-file, or from standard input when that is not given. It never appears on the
 * command line. A Warden secret is a base64 string of at least 32 bytes, kept in its own file. Nothing secret is printed,
 * and the operator file must sit outside the repository.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..', '..');
const SECRET_BYTES = 32;
const USERNAME = /^[a-z][a-z0-9._-]{2,31}$/;

function fail(message: string): never {
  process.stderr.write(`console:operator: ${message}\n`);
  process.exit(1);
}

function argumentsOf(args: readonly string[]): {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const queue = [...args];
  for (let arg = queue.shift(); arg !== undefined; arg = queue.shift()) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const value = queue.shift();
    if (value === undefined || value.startsWith('--')) {
      fail(`${arg} needs a value`);
    }
    flags.set(arg.slice(2), value);
  }
  return { positional, flags };
}

function passwordOf(flags: ReadonlyMap<string, string>): string {
  const file = flags.get('password-file');
  // The password is read once, from a file the operator names or from standard input, and is never echoed.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own password file, outside the repository
  const text = file === undefined ? readFileSync(0, 'utf8') : readFileSync(resolve(file), 'utf8');
  return text.replace(/\r?\n$/, '');
}

/** The operators the file holds now, or none when the file does not exist yet. */
function recordsOf(file: string): readonly OperatorInput[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own file, checked before it is read
  if (!existsSync(file)) {
    return [];
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own file, read for a listing or before it is replaced
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    readonly operators: readonly OperatorInput[];
  };
  return parsed.operators;
}

function listing(file: string): void {
  const records = recordsOf(file);
  if (records.length === 0) {
    process.stdout.write('no operators yet\n');
    return;
  }
  for (const record of records) {
    process.stdout.write(`${record.username} ${record.role}\n`);
  }
}

async function add(
  file: string,
  positional: readonly string[],
  flags: ReadonlyMap<string, string>,
): Promise<void> {
  const [username = '', roleText = ''] = positional;
  if (!USERNAME.test(username)) {
    fail(
      'the username is 3 to 32 characters: a lower-case letter first, then letters, digits, dot, dash or underscore',
    );
  }
  if (!(ROLES as readonly string[]).includes(roleText)) {
    fail('the role is operator or viewer');
  }
  const role = roleText as Role;
  const principal = flags.get('principal') ?? null;
  const secretFile = flags.get('secret-file') ?? null;
  if (role === 'operator' && (principal === null || secretFile === null)) {
    fail('an operator needs --principal and --secret-file');
  }
  if (role === 'viewer' && (principal !== null || secretFile !== null)) {
    fail('a viewer has no Warden principal or secret');
  }
  let secret: string | null = null;
  if (secretFile !== null) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own secret file, outside the repository
    const text = readFileSync(resolve(secretFile), 'utf8').trim();
    if (Buffer.from(text, 'base64').length < SECRET_BYTES) {
      fail(`the secret must be base64 of at least ${String(SECRET_BYTES)} bytes`);
    }
    secret = text;
  }
  const password = passwordOf(flags);
  const problem = passwordProblem(password);
  if (problem !== null) {
    fail(problem);
  }
  const next: OperatorInput = {
    username,
    role,
    passwordHash: await hashPassword(password),
    wardenPrincipal: principal,
    wardenSecret: secret,
  };
  let updated: OperatorInput[];
  try {
    updated = upsertOperator(recordsOf(file), next);
  } catch {
    // The validation message could quote a stored value, so it is not shown.
    fail('the operator file would not load with this change; nothing was written');
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own folder, outside the repository
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own file, written in its own folder
  writeFileSync(temp, `${JSON.stringify({ schemaVersion: 1, operators: updated }, null, 2)}\n`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- replaces the operator's own file with the new copy
  renameSync(temp, file);
  process.stdout.write(
    `${username} is a ${role} now. The operator file holds password hashes and Warden secrets; keep it private.\n`,
  );
}

async function main(): Promise<void> {
  const [command = '', ...rest] = process.argv.slice(2);
  const { positional, flags } = argumentsOf(rest);
  const file = resolve(flags.get('file') ?? join(defaultLocalDir(), 'console', 'operators.json'));
  try {
    assertOutsideRepository(dirname(file), repoRoot);
  } catch {
    fail('the operator file must be outside the repository');
  }
  if (command === 'list') {
    listing(file);
    return;
  }
  if (command !== 'add') {
    fail('the command is add or list');
  }
  await add(file, positional, flags);
}

main().catch(() => {
  fail('the operation did not finish; nothing secret is shown');
});
