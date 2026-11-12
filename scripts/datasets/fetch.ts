// Downloads the LOCAL-ONLY public datasets listed in docs/DATA.md into .local-datasets/ (gitignored).
// These sets are used only to measure the extractor. They are never committed, never copied into
// fixtures, and their licences are quoted in docs/DATA.md. Run one set at a time:
//   npx tsx scripts/datasets/fetch.ts katanaml-org/invoices-donut-data-v1
//   npx tsx scripts/datasets/fetch.ts naver-clova-ix/cord-v2
// The file list comes from the Hugging Face API, so no file name is hard-coded here.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = new Set(['katanaml-org/invoices-donut-data-v1', 'naver-clova-ix/cord-v2']);
const HF_API = 'https://huggingface.co/api/datasets';
const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.resolve(here, '../../.local-datasets');

interface HfSibling {
  rfilename: string;
}

interface HfDataset {
  id: string;
  siblings: HfSibling[];
  cardData?: { license?: string };
}

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || !ALLOWED.has(id)) {
    throw new Error(`dataset must be one of: ${[...ALLOWED].join(', ')}`);
  }
  const meta = (await (await fetch(`${HF_API}/${id}`)).json()) as HfDataset;
  const licence = meta.cardData?.license ?? 'not stated';
  console.log(`${id}: licence field "${licence}" (see docs/DATA.md for the upstream terms)`);

  const target = path.join(outRoot, id.replace('/', '__'));
  // The target is under .local-datasets/, named from the allow-listed id.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(target, { recursive: true });
  const files = meta.siblings
    .map((s) => s.rfilename)
    .filter((name) => name.endsWith('.parquet') || name === 'README.md');
  if (files.length === 0) throw new Error(`no parquet files listed for ${id}`);

  for (const name of files) {
    const url = `https://huggingface.co/datasets/${id}/resolve/main/${name}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${name} failed with HTTP ${String(response.status)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    // Keep the file under the target folder only; the name comes from the API listing above.
    const dest = path.join(target, path.basename(name));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(dest, bytes);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const written = await stat(dest);
    console.log(`saved ${path.basename(name)} (${String(written.size)} bytes)`);
  }
  console.log(`done: ${target}`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`fetch: ${reason}`);
  process.exitCode = 1;
});
