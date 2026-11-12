import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/**
 * The graph's decision log: one JSON line per finished invoice, chained by SHA-256 so that a changed or removed line breaks
 * the chain. Every line names the prompt hashes, the route and judge policy versions, and the models used. It holds no
 * invoice text, no quote text and no keys. This file is separate from the lane-owned transition log, whose schema does
 * not carry prompt hashes; folding the two is a follow-up recorded in the ADR.
 */

export interface DecisionEntry {
  readonly seq: number;
  readonly correlationId: string;
  readonly terminal: string;
  readonly finalCode: string;
  readonly trail: readonly string[];
  readonly routePolicy: string;
  readonly ruleId: string | null;
  readonly judgePolicy: string;
  readonly graphVersion: string;
  readonly promptSha256: Readonly<Record<string, string>>;
  readonly models: readonly string[];
  readonly modelCalls: number;
  readonly prevSha256: string;
}

export interface SealedDecision extends DecisionEntry {
  readonly sha256: string;
}

export const GENESIS = '0'.repeat(64);

function hashOf(entry: DecisionEntry): string {
  return createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
}

/** Reads the log and checks every link. Returns the first broken line, or null when the chain is intact. */
export function verifyDecisionLog(path: string): {
  readonly ok: boolean;
  readonly brokenAt: number | null;
} {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  if (!existsSync(path)) {
    return { ok: true, brokenAt: null };
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  let prev = GENESIS;
  for (const [index, line] of lines.entries()) {
    const sealed = JSON.parse(line) as SealedDecision;
    const { sha256, ...entry } = sealed;
    if (entry.prevSha256 !== prev || hashOf(entry) !== sha256) {
      return { ok: false, brokenAt: index + 1 };
    }
    prev = sha256;
  }
  return { ok: true, brokenAt: null };
}

/** Appends one entry. The previous hash is read from the file, so two writers cannot fork the chain silently. */
export function appendDecision(
  path: string,
  entry: Omit<DecisionEntry, 'prevSha256' | 'seq'>,
): SealedDecision {
  const check = verifyDecisionLog(path);
  if (!check.ok) {
    throw new Error(
      `the decision log chain is broken at line ${String(check.brokenAt)}; nothing is appended`,
    );
  }
  let prev = GENESIS;
  let seq = 0;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  if (existsSync(path)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    const last = lines[lines.length - 1];
    if (last !== undefined) {
      const sealed = JSON.parse(last) as SealedDecision;
      prev = sealed.sha256;
      seq = sealed.seq;
    }
  }
  const full: DecisionEntry = { ...entry, seq: seq + 1, prevSha256: prev };
  const sealed: SealedDecision = { ...full, sha256: hashOf(full) };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  appendFileSync(path, `${JSON.stringify(sealed)}\n`, { encoding: 'utf8' });
  return sealed;
}
