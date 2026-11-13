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
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { Wallet } from 'xrpl';

import { loadDotEnv } from '../../../packages/shared/src/node.js';

import { watchedEvidenceRegister } from '../../../packages/shared/src/watched-evidence.js';
import { WardenClient, coSignAsAgent } from '../../../packages/warden-api/src/client.js';

import { auditToCsv, buildAuditExport } from './audit/export.js';
import { AGENT_POLICY_VERSION, assertDataAllowed, chooseModel, type DataClass } from './config.js';
import { loadLabelledSet } from './eval/cases.js';
import { renderReport } from './eval/report.js';
import { evaluate, perCaseScores, scoreBaseline, scorePipeline } from './eval/run.js';
import { compareSides } from './eval/stats.js';
import { simulatedModel } from './eval/simulated-model.js';
import { watchInbox } from './intake/intake.js';
import { DEFAULT_DAILY_USD, DailyCaps } from './model/caps.js';
import type { Attempt } from './model/failover.js';
import { buildLiveChain } from './model/live.js';
import { renderLiveSummary, type LiveCase } from './model/live-summary.js';
import { FAILOVER_ORDER, providerById, type ProviderId } from './model/providers.js';
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
/** A live call may take this long. Gemini answers in tens of seconds on a reasoning model, so 60 seconds is too short. */
const LIVE_TIMEOUT_MS = 120_000;

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
      'daily-calls': { type: 'string' },
      'daily-usd': { type: 'string' },
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
  let baselineModel: ModelClient;
  let modelLabel: string;
  // Live attempts are recorded per case. Baseline calls share the pacer but are kept apart, so they are not counted
  // against a pipeline case. The phase is set only while the baseline call is running, and calls run one at a time.
  const liveAttempts: Attempt[] = [];
  const baselineAttempts: Attempt[] = [];
  let phase: 'pipeline' | 'baseline' = 'pipeline';
  const caseTrails: Attempt[][] = [];
  let pending: Attempt[] = [];
  const sink = {
    record: (attempt: Attempt): void => {
      if (phase === 'baseline') {
        baselineAttempts.push(attempt);
      } else {
        pending.push(attempt);
        liveAttempts.push(attempt);
      }
    },
  };
  // The day's counts persist across runs, so the dollar cap holds for the owner's credit, not just for one run.
  const dailyCaps = new DailyCaps({
    maxCalls: Number(values['daily-calls'] ?? '500'),
    maxUsd: Number(values['daily-usd'] ?? DEFAULT_DAILY_USD),
    file: spendFileOf(),
  });
  let liveChainUsed: readonly string[] = [];
  let liveSkipped: readonly string[] = [];
  let liveLabel = '';
  if (mode === 'fixture') {
    model = simulatedModel('extractor');
    baselineModel = simulatedModel('baseline');
    modelLabel = 'fixture (rule-based stand-in, no model called)';
  } else if (mode === 'live') {
    const ids = providerIdsOf(values.provider);
    liveLabel = ids.join('-');
    const chain = buildLiveChain({
      providerIds: ids,
      ...(values.model === undefined ? {} : { model: values.model }),
      env: process.env,
      sink,
      caps: dailyCaps,
      timeoutMs: LIVE_TIMEOUT_MS,
    });
    liveChainUsed = chain.used;
    liveSkipped = chain.skipped.map((item) => `${item.provider} (${item.reason})`);
    const paced = pacedModel(chain.client, minIntervalMs);
    model = paced;
    baselineModel = {
      label: chain.client.label,
      complete: async (request) => {
        phase = 'baseline';
        try {
          return await paced.complete(request);
        } finally {
          phase = 'pipeline';
        }
      },
    };
    modelLabel = chain.used.join(' > ');
  } else {
    throw new RangeError('the mode must be fixture or live');
  }
  // Each case has its own log. For the agent map, the moves are written one after another with one running sequence
  // number, so the map can replay the whole set in order. The per-case records are unchanged in the report.
  const moveLines: string[] = [];
  let moveSeq = 0;
  const started = Date.now();
  const runs = await evaluate({
    set,
    model,
    baselineModel,
    policyVersion: AGENT_POLICY_VERSION,
    now: () => new Date(),
    onRecords: (records) => {
      // Called once per case, after its pipeline calls and before its baseline call. The attempts so far belong to it.
      caseTrails.push(pending);
      pending = [];
      for (const record of records) {
        moveSeq += 1;
        moveLines.push(JSON.stringify({ ...record, seq: moveSeq }));
      }
    },
  });
  const wallMs = Date.now() - started;
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
  let stem = `${mode}-eval`;
  let liveSection = '';
  if (mode === 'live') {
    stem = `live-${liveLabel}`;
    const liveCases: LiveCase[] = runs.map((run, index) => {
      const attempts = caseTrails.at(index) ?? [];
      const reasonCode = run.pipeline.reasonCode;
      const modelFailed = [
        'MODEL_CALL_FAILED',
        'MODEL_OUTPUT_INVALID',
        'DOCUMENT_TOO_LONG',
      ].includes(reasonCode);
      return {
        id: run.id,
        category: run.category,
        expectedDecision: run.expected.decision,
        decision: run.pipeline.decision,
        reasonCode,
        tokens: run.pipeline.tokens,
        extracted: attempts.length > 0 && !modelFailed,
        attempts,
      };
    });
    liveSection = renderLiveSummary({
      chainUsed: liveChainUsed,
      skipped: liveSkipped,
      cases: liveCases,
      baselineAttempts,
      wallMs,
    });
    writeFileSync(
      join(out, `${stem}-attempts.json`),
      `${JSON.stringify({ generatedAt, pipelineAttempts: liveAttempts, baselineAttempts }, null, 2)}\n`,
      'utf8',
    );
  }
  writeFileSync(join(out, `${stem}.md`), `${report}${liveSection}`, 'utf8');
  writeFileSync(
    join(out, `${stem}.json`),
    `${JSON.stringify({ mode: pipelineLabel, generatedAt, policyVersion: AGENT_POLICY_VERSION, model: modelLabel, pipeline, baseline, comparisons, runs }, null, 2)}\n`,
    'utf8',
  );
  line(`wrote ${join(out, `${stem}.md`)} for ${String(runs.length)} cases (${pipelineLabel})`);
}

/** The file that holds the day's spend across runs, under the user's local application data. It is created if needed. */
function spendFileOf(): string {
  const dir = join(process.env['LOCALAPPDATA'] ?? tmpdir(), 'SignOff', 'model-spend');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'daily-caps.json');
}

/** The provider list from --provider: a comma-separated list in the order to try, or the full failover order. */
function providerIdsOf(text: string | undefined): ProviderId[] {
  if (text === undefined) {
    return [...FAILOVER_ORDER];
  }
  const ids: ProviderId[] = [];
  for (const raw of text.split(',')) {
    const id = raw.trim();
    const provider = providerById(id);
    if (!ids.includes(provider.id)) {
      ids.push(provider.id);
    }
  }
  return ids;
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
  // Real invoices go only to the one provider the operator has confirmed, never through a failover to another. The
  // chain for fictional data tries the providers in order.
  let providerIds: ProviderId[] = providerIdsOf(values.provider);
  if (dataClass === 'real') {
    const acknowledged = values['zero-retention-ack'];
    if (acknowledged === undefined) {
      throw new RangeError('real invoices need --zero-retention-ack with one provider id');
    }
    const choice = chooseModel(acknowledged, values.model);
    assertDataAllowed({ dataClass, choice, zeroRetentionAck: acknowledged });
    providerIds = [choice.provider.id];
  }
  const chain = buildLiveChain({
    providerIds,
    ...(values.model === undefined ? {} : { model: values.model }),
    env,
    caps: new DailyCaps({ file: join(dirname(logPath), 'daily-caps.json') }),
  });
  const model = chain.client;

  const evidence = watchedEvidenceRegister(evidencePath);
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
