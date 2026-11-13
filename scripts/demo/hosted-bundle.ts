/* eslint-disable security/detect-non-literal-fs-filename -- the paths are inside the local SignOff folder, checked by assertOutsideRepository */
// Prepares the hosted Warden (docs/HOSTED-WARDEN.md). It writes a batch of fictional clean invoices to the outbox, with
// their order and receipt records, and then packs the local Warden folder into one value for the hosted Warden's
// SIGNOFF_WARDEN_BUNDLE variable. The hosted Warden cannot see records written on this machine later, so every invoice
// to be emailed during the demo is prepared here, before the bundle is made.
//
//   npm run demo:hosted-bundle                       8 invoices of R20.00
//   npm run demo:hosted-bundle -- --invoices 5 --zar 16.00
//
// The bundle holds the Warden's key, so it is written outside the repository with owner-only permissions, and only
// its path and size are printed. Paste it into Railway yourself; never into chat or a repository.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { assertOutsideRepository, defaultLocalDir } from '../../packages/xrpl/src/node.js';
import { writeDemoInvoice } from './demo-invoice.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** The Warden files the hosted Warden needs. The start script on Railway accepts exactly these names. */
export const BUNDLE_FILES = [
  'warden-config.json',
  'warden-keys.json',
  'warden-callers.json',
  'evidence.json',
  'events.jsonl',
  'payments-journal.jsonl',
] as const;

/** The hosted Warden listens on every interface on port 8080, behind Railway's HTTPS. */
export function hostedConfig(localConfig: string): string {
  const config = JSON.parse(localConfig) as Record<string, unknown>;
  config['listen'] = { host: '0.0.0.0', port: 8080 };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Packs the files: a JSON map of name to content, gzipped, then base64. */
export function packBundle(files: Readonly<Record<string, string>>): string {
  return gzipSync(Buffer.from(JSON.stringify(files), 'utf8')).toString('base64');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const countText = args.includes('--invoices')
    ? (args[args.indexOf('--invoices') + 1] ?? '')
    : '8';
  const zarText = args.includes('--zar') ? (args[args.indexOf('--zar') + 1] ?? '') : '20.00';
  if (!/^\d{1,2}$/.test(countText) || Number(countText) < 1) {
    throw new Error('--invoices must be a number from 1 to 99');
  }
  if (!/^\d+\.\d{2}$/.test(zarText)) {
    throw new Error('--zar must be a rand amount such as 20.00');
  }
  const localDir = defaultLocalDir();
  assertOutsideRepository(localDir, repoRoot);

  const made: string[] = [];
  for (let index = 0; index < Number(countText); index += 1) {
    const invoice = await writeDemoInvoice(Number(zarText.replace('.', '')), localDir, {
      delivery: 'outbox',
    });
    made.push(invoice.file);
    // Invoice numbers are stamped to the second, so each needs its own second.
    await new Promise((done) => {
      setTimeout(done, 1100);
    });
  }

  const wardenDir = join(localDir, 'warden');
  const files: Record<string, string> = {};
  for (const name of BUNDLE_FILES) {
    const content = readFileSync(join(wardenDir, name), 'utf8');
    // eslint-disable-next-line security/detect-object-injection -- name comes from the fixed BUNDLE_FILES list
    files[name] = name === 'warden-config.json' ? hostedConfig(content) : content;
  }
  const bundle = packBundle(files);
  const outDir = join(localDir, 'hosted');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'warden-bundle.b64');
  writeFileSync(outPath, bundle, { mode: 0o600 });

  process.stdout.write(
    `${JSON.stringify(
      {
        invoicesInOutbox: made,
        bundle: outPath,
        bundleCharacters: bundle.length,
        next: 'Paste the file content into the Railway variable SIGNOFF_WARDEN_BUNDLE yourself (docs/HOSTED-WARDEN.md). Do not paste it into chat.',
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'unknown failure'}\n`);
    process.exitCode = 1;
  });
}
