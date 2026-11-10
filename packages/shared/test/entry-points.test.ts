import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as core from '../src/index.js';
import * as node from '../src/node.js';

const srcRoot = resolve(import.meta.dirname, '..', 'src');

/** Every TypeScript file under a directory, found by walking it. */
function filesUnder(directory: string): string[] {
  const found: string[] = [];
  // Test-only walk of this package's own source directory, located from import.meta.dirname.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
    } else if (name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

describe('platform-neutral entry point', () => {
  it('exposes money and schemas, and not the Node-only security or hashing helpers', () => {
    expect(core).toHaveProperty('parseMoneyText');
    expect(core).toHaveProperty('PaymentProposal');
    expect(core).not.toHaveProperty('findSecrets');
    expect(core).not.toHaveProperty('obligationKey');
    expect(core).not.toHaveProperty('base58Encode');
  });

  it('contains no Node built-in imports anywhere in its money and schema modules', () => {
    const neutralFiles = [
      join(srcRoot, 'index.ts'),
      ...filesUnder(join(srcRoot, 'money')),
      ...filesUnder(join(srcRoot, 'schemas')),
    ];
    for (const path of neutralFiles) {
      // Test-only read of files inside this repository, located by walking the source tree.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/from ['"]node:/);
      expect(source, path).not.toMatch(/require\(['"]node:/);
    }
  });
});

describe('Node-only entry point', () => {
  it('exposes the security checks and the obligation identity', () => {
    expect(node).toHaveProperty('findSecrets');
    expect(node).toHaveProperty('isXrplFamilySeed');
    expect(node).toHaveProperty('obligationKey');
    expect(node).toHaveProperty('normaliseInvoiceNumber');
  });
});
