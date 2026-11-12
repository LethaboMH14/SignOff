/**
 * Downloads the OFAC SDN list and writes the cached snapshot the Warden reads (apps/warden/src/checks/sanctions.ts).
 *
 * Run: npm run sanctions:refresh. Fetches https://www.treasury.gov/ofac/downloads/sdn.csv (it redirects to the
 * published file), records the UTC date and SHA-256 of the bytes, and writes
 * apps/warden/var/sanctions/ofac-sdn.json. That path is gitignored; the list is not committed.
 *
 * Fails with a non-zero exit when the download or the parse fails. The old cache is left in place, so the Warden
 * holds once it passes SANCTIONS_MAX_AGE_DAYS rather than screening against a half-written file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OFAC_SDN_URL,
  snapshotFromSdnCsv,
} from '../../apps/warden/src/checks/sanctions-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../apps/warden/var/sanctions/ofac-sdn.json');

async function main(): Promise<void> {
  const response = await fetch(OFAC_SDN_URL, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`OFAC download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const retrievedAt = new Date().toISOString().slice(0, 10);

  const snapshot = snapshotFromSdnCsv(bytes.toString('utf8'), {
    sourceUrl: OFAC_SDN_URL,
    retrievedAt,
    sourceSha256,
  });
  if (snapshot.entries.length < 1000) {
    throw new Error(`OFAC parse produced ${snapshot.entries.length} entries; refusing to replace the cache`);
  }

  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(tmp, out);
  console.log(
    `OFAC SDN cache written: ${snapshot.entries.length} entries, retrieved ${retrievedAt}, sha256 ${sourceSha256}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
