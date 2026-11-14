import { existsSync, readFileSync } from 'node:fs';

/**
 * A small reader for a local .env file: KEY=VALUE lines, an optional "export" prefix, matching quotes, and "#" comment
 * lines. It never expands variables and never returns or prints a value. A variable the environment already holds is
 * left alone, so the shell wins over the file. Errors name a line number, never its content, because a line may hold
 * a secret.
 */

const NAME = /^[A-Z_][A-Z0-9_]*$/;

export interface DotEnvLoad {
  /** The variables the file set, in file order. Values are not returned. */
  readonly loaded: readonly string[];
  /** Variables the file names but the environment already holds, which were left alone. */
  readonly kept: readonly string[];
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0);
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Parses the text of a .env file. Empty values are kept, so the caller can tell them apart from absent ones. */
export function parseDotEnv(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equals = body.indexOf('=');
    if (equals === -1) {
      throw new RangeError(`line ${String(index + 1)} of the .env file is not KEY=VALUE`);
    }
    const name = body.slice(0, equals).trim();
    if (!NAME.test(name)) {
      throw new RangeError(`line ${String(index + 1)} of the .env file names an invalid variable`);
    }
    values.set(name, unquote(body.slice(equals + 1).trim()));
  });
  return values;
}

/** Sets the file's variables in the environment, without overwriting one the environment already has. */
export function loadDotEnv(path: string, environment: NodeJS.ProcessEnv = process.env): DotEnvLoad {
  // The path is the operator's own .env file in the working folder, read once at start-up.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own .env file, read once at start-up
  if (!existsSync(path)) {
    return { loaded: [], kept: [] };
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own .env file, read once at start-up
  const values = parseDotEnv(readFileSync(path, 'utf8'));
  const loaded: string[] = [];
  const kept: string[] = [];
  for (const [name, value] of values) {
    if (value === '') {
      continue;
    }
    const current: unknown = Reflect.get(environment, name);
    if (typeof current === 'string' && current !== '') {
      kept.push(name);
      continue;
    }
    Reflect.set(environment, name, value);
    loaded.push(name);
  }
  return { loaded, kept };
}
