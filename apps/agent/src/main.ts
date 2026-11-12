/**
 * The agent's command line. It is the only file that reads the environment and the operating system, so it is wired
 * here and not unit-tested. Its parts are tested where they are defined.
 *
 *   eval    scores the pipeline and the single-prompt baseline on the labelled set (fixture or live)
 *   run     watches the inbox and runs each invoice through the workflow against a Warden
 *   export  writes the audit export for one payment or one invoice file
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the CLI reads and writes the paths its operator names */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { Wallet } from 'xrpl';

import { loadDotEnv } from '../../../packages/shared/src/node.js';

import { evidenceRegister } from '../../../packages/shared/src/evidence-register.js';
import { EvidenceFile } from '../../../packages/shared/src/schemas/evidence.js';
import { WardenClient, coSignAsAgent } from '../../../packages/warden-api/src/client.js';

import { auditToCsv, buildAuditExport } from './audit/export.js';
import {
  AGENT_POLICY_VERSION,
  assertDataAllowed,
  chooseModel,
  keyFor,
  type DataClass,
} from './config.js';
import { loadLabelledSet } from './eval/cases.js';
import { renderReport } from './eval/report.js';
import { evaluate, perCaseScores, scoreBaseline, scorePipeline } from './eval/run.js';
import { compareSides } from './eval/stats.js';
import { simulatedModel } from './eval/simulated-model.js';
import { watchInbox } from './intake/intake.js';
import { createChatClient } from './model/chat-client.js';
import { baseUrlOf } from './model/providers.js';
import { intervalOf, pacedModel } from './model/pacing.js';
import type { ModelClient } from './model/types.js';
import { parseSupplierMaster } from './match/supplier-master.js';
import { TransitionLog, withRunLockAsync } from './log/transition-log.js';
import { processInvoice } from './workflow/pipeline.js';
import { conversionOf, convertZarLive, type UsdConversion } from './workflow/fx-convert.js';
import { fixtureUsdZarRate } from '../../../packages/shared/src/fx/index.js';
import { wardenPortOf } from './workflow/warden-port.js';

const DEFAULT_SET = fileURLToPath(new URL('../fixtures/labelled', import.meta.url));
const DEFAULT_RESULTS = fileURLToPath(new URL('../results', import.meta.url));
const HEX = /^[0-9a-f]{64}$/;

/** An option that the command cannot run without. */
function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new RangeError(`--${name} is required`);
  }
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

async function evalCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      set: { type: 'string' },
      mode: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      out: { type: 'string' },
      transitions: { type: 'string' },
      'min-interval-ms': { type: 'string' },
    },
    strict: true,
  });
  const mode = values.mode ?? 'fixture';
  const minIntervalMs = intervalOf(values['min-interval-ms']);
  const set = loadLabelledSet(resolve(values.set ?? DEFAULT_SET));
  if (!set.notice.includes('FICTIONAL')) {
    throw new RangeError(
      'the labelled set does not carry the fictional-data notice, so it is not evaluated here',
    );
  }
  let model: ModelClient;
  let modelLabel: string;
  if (mode === 'fixture') {
    model = simulatedModel('extractor');
    modelLabel = 'fixture (rule-based stand-in, no model called)';
  } else if (mode === 'live') {
    const choice = chooseModel(values.provider ?? 'openrouter', values.model);
    model = pacedModel(
      createChatClient({
        provider: choice.provider,
        model: choice.model,
        apiKey: keyFor(choice.provider, process.env),
        baseUrl: baseUrlOf(choice.provider, process.env),
      }),
      minIntervalMs,
    );
    modelLabel = model.label;
  } else {
    throw new RangeError('the mode must be fixture or live');
  }
  const baselineModel = mode === 'fixture' ? simulatedModel('baseline') : model;
  // Each case has its own log. For the agent map, the moves are written one after another with one running sequence
  // number, so the map can replay the whole set in order. The per-case records are unchanged in the report.
  const moveLines: string[] = [];
  let moveSeq = 0;
  const runs = await evaluate({
    set,
    model,
    baselineModel,
    policyVersion: AGENT_POLICY_VERSION,
    now: () => new Date(),
    onRecords: (records) => {
      for (const record of records) {
        moveSeq += 1;
        moveLines.push(JSON.stringify({ ...record, seq: moveSeq }));
      }
    },
  });
  if (values.transitions !== undefined) {
    writeFileSync(
      resolve(values.transitions),
      moveLines.map((line) => line + '\n').join(''),
      'utf8',
    );
  }
  const pipeline = scorePipeline(runs);
  const baseline = scoreBaseline(runs);
  const swarmScores = perCaseScores(runs, 'pipeline');
  const baselineScores = perCaseScores(runs, 'baseline');
  const comparisons = [
    compareSides('Decision correct', swarmScores.decision, baselineScores.decision),
    compareSides('Fields read as labelled (share of 7)', swarmScores.fields, baselineScores.fields),
    compareSides(
      'No false approval (1 unless HOLD was decided ELIGIBLE)',
      swarmScores.noFalseApproval,
      baselineScores.noFalseApproval,
    ),
  ];
  const generatedAt = new Date().toISOString();
  const pipelineLabel = mode === 'fixture' ? 'FIXTURE' : 'LIVE';
  const report = renderReport({
    mode: pipelineLabel,
    pipelineModel: modelLabel,
    baselineModel: mode === 'fixture' ? simulatedModel('baseline').label : modelLabel,
    policyVersion: AGENT_POLICY_VERSION,
    generatedAt,
    notice: set.notice,
    runs,
    pipeline,
    baseline,
    comparisons,
  });
  const out = resolve(values.out ?? DEFAULT_RESULTS);
  mkdirSync(out, { recursive: true });
  const stem = `${mode}-eval`;
  writeFileSync(join(out, `${stem}.md`), report, 'utf8');
  writeFileSync(
    join(out, `${stem}.json`),
    `${JSON.stringify({ mode: pipelineLabel, generatedAt, policyVersion: AGENT_POLICY_VERSION, model: modelLabel, pipeline, baseline, comparisons, runs }, null, 2)}\n`,
    'utf8',
  );
  line(`wrote ${join(out, `${stem}.md`)} for ${String(runs.length)} cases (${pipelineLabel})`);
}

function exportCommand(args: readonly string[]): void {
  const { values } = parseArgs({
    args: [...args],
    options: {
      log: { type: 'string' },
      obligation: { type: 'string' },
      correlation: { type: 'string' },
      'warden-log': { type: 'string' },
      format: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (values.log === undefined) {
    throw new RangeError('--log is required');
  }
  const selectorValue = values.obligation ?? values.correlation;
  if (selectorValue === undefined || !HEX.test(selectorValue)) {
    throw new RangeError(
      'give --obligation or --correlation with a 64-character lower-case hex value',
    );
  }
  const log = TransitionLog.open(resolve(values.log), () => new Date());
  const wardenLines =
    values['warden-log'] === undefined
      ? []
      : readFileSync(resolve(values['warden-log']), 'utf8').split('\n');
  const exported = buildAuditExport({
    records: log.records(),
    selector: {
      obligationKey: values.obligation ?? null,
      correlationId: values.correlation ?? null,
    },
    wardenLines,
    now: new Date(),
  });
  const format = values.format ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    throw new RangeError('the format must be json or csv');
  }
  const text = format === 'csv' ? auditToCsv(exported) : `${JSON.stringify(exported, null, 2)}\n`;
  if (values.out === undefined) {
    process.stdout.write(text);
  } else {
    writeFileSync(resolve(values.out), text, 'utf8');
    line(`wrote ${resolve(values.out)}`);
  }
}

async function runCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      inbox: { type: 'string' },
      log: { type: 'string' },
      evidence: { type: 'string' },
      suppliers: { type: 'string' },
      'warden-url': { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      data: { type: 'string' },
      'zero-retention-ack': { type: 'string' },
      'interval-ms': { type: 'string' },
      fx: { type: 'string' },
    },
    strict: true,
  });
  const inboxDir = resolve(required(values.inbox, 'inbox'));
  const logPath = resolve(required(values.log, 'log'));
  const evidencePath = resolve(required(values.evidence, 'evidence'));
  const suppliersPath = resolve(required(values.suppliers, 'suppliers'));
  const wardenUrl = required(values['warden-url'], 'warden-url');
  const env = process.env;
  const agentId = env['SIGNOFF_AGENT_ID'];
  const agentSecret = env['SIGNOFF_AGENT_SECRET'];
  const agentSeed = env['SIGNOFF_AGENT_SEED'];
  if (agentId === undefined || agentSecret === undefined || agentSeed === undefined) {
    throw new RangeError(
      'set SIGNOFF_AGENT_ID, SIGNOFF_AGENT_SECRET and SIGNOFF_AGENT_SEED in your environment',
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(agentSecret) || agentSecret.length % 2 !== 0) {
    throw new RangeError('SIGNOFF_AGENT_SECRET must be hex');
  }

  const dataClass: DataClass = values.data === 'real' ? 'real' : 'fictional';
  const choice = chooseModel(values.provider ?? 'openrouter', values.model);
  assertDataAllowed({ dataClass, choice, zeroRetentionAck: values['zero-retention-ack'] ?? null });
  const model = createChatClient({
    provider: choice.provider,
    model: choice.model,
    apiKey: keyFor(choice.provider, env),
    baseUrl: baseUrlOf(choice.provider, env),
  });

  const evidence = evidenceRegister(EvidenceFile.parse(readJson(evidencePath)));
  const suppliers = parseSupplierMaster(readJson(suppliersPath));
  const stateDir = dirname(logPath);
  mkdirSync(stateDir, { recursive: true });
  const warden = wardenPortOf(
    new WardenClient({
      baseUrl: wardenUrl,
      principalId: agentId,
      secret: Buffer.from(agentSecret, 'hex'),
    }),
  );
  const wallet = Wallet.fromSeed(agentSeed);
  const intervalMs = Number(values['interval-ms'] ?? '5000');
  if (!Number.isInteger(intervalMs) || intervalMs < 500) {
    throw new RangeError('--interval-ms must be a whole number of at least 500');
  }

  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
  });
  process.once('SIGTERM', () => {
    controller.abort();
  });

  await withRunLockAsync(stateDir, async () => {
    const log = TransitionLog.open(logPath, () => new Date());
    // Rand invoices are converted at the live USD/ZAR rate. `--fx fixture` uses the committed capture (offline runs).
    const fxMode = values.fx ?? 'live';
    if (fxMode !== 'live' && fxMode !== 'fixture') {
      throw new RangeError('--fx must be live or fixture');
    }
    const convert = (zarMinor: number): Promise<UsdConversion> =>
      fxMode === 'live'
        ? convertZarLive(zarMinor)
        : Promise.resolve(conversionOf(zarMinor, fixtureUsdZarRate()));
    const deps = {
      model,
      evidence,
      suppliers,
      log,
      policyVersion: AGENT_POLICY_VERSION,
      now: () => new Date(),
      newAttemptId: () => randomUUID(),
      warden,
      convert,
      signer: { coSign: (blob: string) => coSignAsAgent(wallet, blob) },
    };
    line('agent running. Press Ctrl+C to stop.');
    await watchInbox({
      dir: inboxDir,
      seen: new Set<string>(log.correlationIds()),
      intervalMs,
      signal: controller.signal,
      onOutcome: async (key, _path, outcome) => {
        const result = await processInvoice({ correlationId: key, outcome }, deps);
        line(`${key.slice(0, 12)} ${result.finalState} ${result.reasonCode}`);
      },
    });
  });
  line('agent stopped.');
}

async function main(argv: readonly string[]): Promise<void> {
  const dotEnv = loadDotEnv(resolve('.env'));
  if (dotEnv.loaded.length > 0) {
    line(`loaded ${String(dotEnv.loaded.length)} variables from .env`);
  }
  const [command, ...rest] = argv;
  if (command === 'eval') {
    await evalCommand(rest);
  } else if (command === 'export') {
    exportCommand(rest);
  } else if (command === 'run') {
    await runCommand(rest);
  } else {
    line('usage: agent <eval|run|export> [options]');
    process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // Only the message is printed. A stack trace could show paths or values that do not belong on a screen.
  const message = error instanceof Error ? error.message : 'the command failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
