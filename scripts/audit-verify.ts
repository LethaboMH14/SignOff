// Verifies a hash-chained transition log (one JSON entry per line: {seq, prevHash, payload, hash}).
// Usage: npm run audit:verify -- <path-to-log.jsonl>. Exit 0 when the chain is intact, 1 when it is broken, 2 on bad usage.
// Pure check: reads the file, never writes it.

import { readFileSync } from 'node:fs';

import { type ChainEntry, verifyChain } from '../packages/shared/src/audit/hash-chain.js';

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write('usage: npm run audit:verify -- <path-to-log.jsonl>\n');
  process.exit(2);
}

const lines = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');
const chain = lines.map((line) => JSON.parse(line) as ChainEntry);
const result = verifyChain(chain);
if (result.ok) {
  process.stdout.write(`chain intact: ${String(result.length)} entries, head ${result.head}\n`);
  process.exit(0);
}
process.stdout.write(`chain BROKEN at index ${String(result.index)}: ${result.reason}\n`);
process.exit(1);
