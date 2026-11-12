import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadLabelledSet, type LabelledCase } from '../eval/cases.js';
import { createChatClient } from '../model/chat-client.js';
import { pacedModel, intervalOf } from '../model/pacing.js';
import { chooseModel, keyFor } from '../config.js';
import { baseUrlOf } from '../model/providers.js';
import type { ModelClient } from '../model/types.js';

import {
  metered,
  placeboOf,
  runSingle,
  runSwarm,
  type ArmContext,
  type ArmResult,
  type Meter,
} from './arms.js';

/**
 * The live paired experiment. It runs every labelled case through three arms in turn (single, placebo, swarm), and writes one
 * JSON line per case and arm. It is resumable: a line already in the file is not run again, so a provider outage or a rate
 * limit can be resumed without repeating a call. Every model call is real; the labelled set is fictional and marked so.
 *
 * Usage (from apps/agent):
 *   npx tsx src/experiment/run.ts --provider groq --min-interval-ms 2500 --out ../../results/swarm/runs.jsonl
 */

export const ARMS = ['single', 'placebo', 'swarm'] as const;
export type Arm = (typeof ARMS)[number];

export interface RunLine {
  readonly caseId: string;
  readonly category: string;
  readonly arm: Arm;
  readonly expected: 'ELIGIBLE' | 'HOLD';
  readonly decision: 'ELIGIBLE' | 'HOLD';
  readonly code: string;
  readonly route: string | null;
  readonly modelCalls: number;
  readonly failures: number;
  readonly inChars: number;
  readonly outChars: number;
  readonly latencyMs: number;
  readonly fieldsCorrect: number;
  readonly fieldsTotal: number;
  readonly model: string;
}

const FIELDS = [
  'supplierName',
  'invoiceNumber',
  'invoiceDate',
  'currency',
  'totalMinor',
  'purchaseOrderNumber',
  'payeeAccountAsPrinted',
] as const;

export function fieldsCorrectOf(
  result: ArmResult,
  expected: Readonly<Record<string, unknown>>,
): number {
  const v = result.verified;
  if (v === null) {
    return 0;
  }
  const readings: Readonly<Record<(typeof FIELDS)[number], unknown>> = {
    supplierName: v.supplierName.value,
    invoiceNumber: v.invoiceNumber.value,
    invoiceDate: v.invoiceDate.value,
    currency: v.currency.value,
    totalMinor: v.total.value === null ? null : v.total.value.minor,
    purchaseOrderNumber: v.purchaseOrderNumber.value,
    payeeAccountAsPrinted: v.payeeAccountAsPrinted.value,
  };
  // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
  return FIELDS.filter((field) => readings[field] === (expected[field] ?? null)).length;
}

function readLines(path: string): RunLine[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  if (!existsSync(path)) {
    return [];
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunLine);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      set: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'min-interval-ms': { type: 'string' },
      out: { type: 'string' },
      limit: { type: 'string' },
    },
    strict: true,
  });
  const here = dirname(fileURLToPath(import.meta.url));
  const set = loadLabelledSet(resolve(values.set ?? `${here}/../../fixtures/labelled`));
  if (!set.notice.includes('FICTIONAL')) {
    throw new RangeError('the labelled set does not carry the fictional-data notice');
  }
  const choice = chooseModel(values.provider ?? 'groq', values.model);
  const interval = intervalOf(values['min-interval-ms'] ?? '2500');
  const out = resolve(values.out ?? `${here}/../../results/swarm/runs.jsonl`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  mkdirSync(dirname(out), { recursive: true });
  const base: ModelClient = createChatClient({
    provider: choice.provider,
    model: choice.model,
    apiKey: keyFor(choice.provider, process.env),
    baseUrl: baseUrlOf(choice.provider, process.env),
  });
  const paced = pacedModel(base, interval);
  const done = new Set(readLines(out).map((line) => `${line.caseId}|${line.arm}`));
  const limit = values.limit === undefined ? set.cases.length : Number(values.limit);
  const cases: LabelledCase[] = [...set.cases]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, limit);

  const meta = resolve(out.replace(/\.jsonl$/, '.meta.json'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  writeFileSync(
    meta,
    JSON.stringify(
      {
        notice:
          'Live paired run on the FICTIONAL labelled set. Every call is a real provider call.',
        provider: choice.provider.id,
        model: choice.model,
        minIntervalMs: interval,
        arms: ARMS,
        cases: cases.length,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  const clock = (): number => Date.now();
  for (const item of cases) {
    for (const arm of ARMS) {
      if (done.has(`${item.id}|${arm}`)) {
        continue;
      }
      const cleared = new Set<string>();
      const ctx: ArmContext = { set, cleared, now: clock };
      const meter: Meter = arm === 'placebo' ? metered(placeboOf(paced)) : metered(paced);
      const result =
        arm === 'swarm' ? await runSwarm(item, meter, ctx) : await runSingle(item, meter, ctx);
      const line: RunLine = {
        caseId: item.id,
        category: item.category,
        arm,
        expected: item.expected.decision,
        decision: result.decision,
        code: result.code,
        route: result.route,
        modelCalls: result.modelCalls,
        failures: result.failures,
        inChars: result.inChars,
        outChars: result.outChars,
        latencyMs: result.latencyMs,
        fieldsCorrect: fieldsCorrectOf(result, item.expected.fields),
        fieldsTotal: FIELDS.length,
        model: base.label,
      };
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
      appendFileSync(out, `${JSON.stringify(line)}\n`, 'utf8');
      process.stdout.write(
        `${item.id} ${arm} -> ${line.decision} (${line.code}) calls=${String(line.modelCalls)}\n`,
      );
    }
  }
  process.stdout.write(`done: ${String(readLines(out).length)} lines in ${out}\n`);
}

// Runs only as the entry point, so importing ARMS from this module has no side effect.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'the experiment stopped';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
