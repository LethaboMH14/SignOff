// Command-line entry: npm run gen:invoices. Writes the fictional corpus to apps/agent/fixtures/generated.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultOut = path.resolve(here, '../../apps/agent/fixtures/generated');

const started = Date.now();
const { result } = await generate(defaultOut);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `gen-invoices: ${String(result.invoices)} invoices, ${String(result.files)} files, ${String(result.documents)} PO/GRN documents in ${seconds}s`,
);
console.log(`gen-invoices: by split ${JSON.stringify(result.bySplit)}`);
console.log(`gen-invoices: by form ${JSON.stringify(result.byForm)}`);
console.log(`gen-invoices: written to ${result.outDir}`);
