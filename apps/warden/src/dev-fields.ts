/**
 * Gate for fields that exist only for development (lane H, SECURITY-MODEL section 5).
 *
 * A dev-only field is added to a response only when BOTH hold: SIGNOFF_DEV_FIELDS is exactly '1', and NODE_ENV is not
 * 'production'. Anything else returns the base object unchanged, so a stray environment variable cannot expose a field.
 */
export function devFieldsAllowed(env: NodeJS.ProcessEnv): boolean {
  return env['SIGNOFF_DEV_FIELDS'] === '1' && env['NODE_ENV'] !== 'production';
}

/** Returns `base`, plus `devOnly` when the gate is open. The base object is never mutated. */
export function withDevFields<T extends object>(
  base: T,
  devOnly: Readonly<Record<string, unknown>>,
  allowed: boolean,
): T | (T & Readonly<Record<string, unknown>>) {
  return allowed ? { ...base, ...devOnly } : base;
}
