import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Guard tests: these fail if someone weakens the configuration that Gate 0 requires.
const root = resolve(import.meta.dirname, '..');

function readText(relativePath: string): string {
  // Test-only read of fixed repository files; every caller passes a literal path from this file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readText(relativePath)) as unknown;
}

function compilerOptionsOf(relativePath: string): Record<string, unknown> {
  const parsed = readJson(relativePath) as { compilerOptions?: Record<string, unknown> };
  return parsed.compilerOptions ?? {};
}

describe('project configuration (Gate 0, F1)', () => {
  it('enables every strictness flag in the shared TypeScript configuration', () => {
    const options = compilerOptionsOf('tsconfig.base.json');
    const requiredFlags = [
      'strict',
      'noUncheckedIndexedAccess',
      'exactOptionalPropertyTypes',
      'noImplicitOverride',
      'noImplicitReturns',
      'noPropertyAccessFromIndexSignature',
      'noUnusedLocals',
      'noUnusedParameters',
      'verbatimModuleSyntax',
    ];
    // One assertion over the whole set, so a failure lists every weakened flag at once.
    expect(options).toEqual(
      expect.objectContaining(Object.fromEntries(requiredFlags.map((flag) => [flag, true]))),
    );
  });

  it('targets the Node 24 runtime everywhere it is declared', () => {
    expect(readText('.nvmrc').trim()).toBe('24');
    const rootPackage = readJson('package.json') as { engines?: Record<string, string> };
    expect(rootPackage.engines?.['node']).toBe('>=24.0.0 <25');
    const sharedPackage = readJson('packages/shared/package.json') as {
      engines?: Record<string, string>;
    };
    expect(sharedPackage.engines?.['node']).toBe('>=24.0.0 <25');
  });

  it('pins exact dependency versions and refuses unsupported Node versions', () => {
    const npmrc = readText('.npmrc');
    expect(npmrc).toMatch(/^save-exact=true$/m);
    expect(npmrc).toMatch(/^engine-strict=true$/m);
  });

  it('declares the shared package as a workspace', () => {
    const rootPackage = readJson('package.json') as { workspaces?: string[] };
    expect(rootPackage.workspaces).toContain('packages/shared');
  });

  it('keeps environment files, private keys and local notes out of git', () => {
    const ignored = readText('.gitignore')
      .split('\n')
      .map((line) => line.trim());
    for (const pattern of ['.env', '.env.*', '*.pem', '*.key', '/notes/']) {
      expect(ignored, pattern).toContain(pattern);
    }
    expect(ignored).toContain('!.env.example');
  });
});
