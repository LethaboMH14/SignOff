import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashes for the console's operators: scrypt with a random salt for each password. The stored form carries its
 * own parameters, so a later change of cost does not break old hashes. A password is never logged or returned.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MEMORY_LIMIT = 64 * 1024 * 1024;
/** Cost used for new hashes: N = 2^14, r = 8, p = 1. */
const COST = { N: 16_384, r: 8, p: 1 } as const;
/** Bounds for a stored hash. A hash outside them is refused rather than trusted. */
const BOUNDS = { maxN: 131_072, maxR: 32, maxP: 4 } as const;

interface Cost {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

function derive(password: string, salt: Buffer, cost: Cost, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      length,
      { N: cost.N, r: cost.r, p: cost.p, maxmem: MEMORY_LIMIT },
      (error, key) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

/** A reason a password is not acceptable, or null. The reason never contains the password. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `the password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `the password must be at most ${String(MAX_PASSWORD_LENGTH)} characters`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST, KEY_LENGTH);
  return `scrypt$N=${String(COST.N)}$r=${String(COST.r)}$p=${String(COST.p)}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** The number after a fixed prefix such as "N=", or null when the part does not have that form. */
function numberOf(part: string | undefined, prefix: 'N=' | 'r=' | 'p='): number | null {
  const text = part ?? '';
  if (!text.startsWith(prefix)) {
    return null;
  }
  const digits = text.slice(prefix.length);
  return /^\d{1,7}$/.test(digits) ? Number(digits) : null;
}

/** Checks a password against a stored hash. A malformed or out-of-bounds hash never verifies. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const N = numberOf(parts[1], 'N=');
  const r = numberOf(parts[2], 'r=');
  const p = numberOf(parts[3], 'p=');
  if (
    N === null ||
    r === null ||
    p === null ||
    N < 2 ||
    N > BOUNDS.maxN ||
    r < 1 ||
    r > BOUNDS.maxR ||
    p < 1 ||
    p > BOUNDS.maxP
  ) {
    return false;
  }
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length < 8 || expected.length < 16 || expected.length > 128) {
    return false;
  }
  try {
    const actual = await derive(password, salt, { N, r, p }, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
