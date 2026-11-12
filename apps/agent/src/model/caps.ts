/* eslint-disable security/detect-non-literal-fs-filename -- the operator names the cap file that holds the counts */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { ModelError } from './types.js';
import type { CallCaps } from './failover.js';

/**
 * The per-day caps on model use: a count of HTTP attempts, a count of tokens the providers reported, and a dollar total
 * at list price. They are the run's last line of defence against a runaway loop or a billing surprise. Attempts that
 * fail are counted too, because a rate-limited or billed-then-cut-off attempt still costs quota or money.
 *
 * A reservation is taken before each attempt, at the worst case that attempt could cost (see failover.ts). It is then
 * settled to the actual cost. So the dollar cap holds: a call that would take the total past the cap is never sent.
 *
 * With a file, the counts survive a restart and a second run, so a crash-and-retry loop cannot reset the day. A file that
 * cannot be read is an error: the run stops rather than start again from zero.
 */

export const DEFAULT_DAILY_CALLS = 500;
export const DEFAULT_DAILY_TOKENS = 2_000_000;
/** The default total spend per UTC day, in US dollars. It is well under the owner's $5 of credit. */
export const DEFAULT_DAILY_USD = 3;

interface Counter {
  readonly day: string;
  calls: number;
  tokens: number;
  usd: number;
}

export interface DailyCapsOptions {
  readonly maxCalls?: number;
  readonly maxTokens?: number;
  readonly maxUsd?: number;
  /** A JSON file that holds the counts, or null to keep them in memory for this run only. */
  readonly file?: string | null;
  readonly now?: () => Date;
}

export class DailyCaps implements CallCaps {
  readonly maxCalls: number;
  readonly maxTokens: number;
  readonly maxUsd: number;
  private readonly file: string | null;
  private readonly now: () => Date;
  private counter: Counter;

  constructor(options: DailyCapsOptions = {}) {
    this.maxCalls = options.maxCalls ?? DEFAULT_DAILY_CALLS;
    this.maxTokens = options.maxTokens ?? DEFAULT_DAILY_TOKENS;
    this.maxUsd = options.maxUsd ?? DEFAULT_DAILY_USD;
    if (!Number.isSafeInteger(this.maxCalls) || this.maxCalls < 1) {
      throw new RangeError('the daily call cap must be a whole number of at least 1');
    }
    if (!Number.isSafeInteger(this.maxTokens) || this.maxTokens < 1) {
      throw new RangeError('the daily token cap must be a whole number of at least 1');
    }
    if (!Number.isFinite(this.maxUsd) || this.maxUsd <= 0) {
      throw new RangeError('the daily dollar cap must be a positive number');
    }
    this.file = options.file ?? null;
    this.now = options.now ?? (() => new Date());
    this.counter = this.load();
  }

  /**
   * Counts one attempt before it is sent, at its worst-case dollar cost. Throws a DAILY_CAP error when the call, token or
   * dollar cap is already used up or would be exceeded.
   */
  reserve(estimateUsd = 0): void {
    this.roll();
    if (this.counter.calls >= this.maxCalls) {
      throw new ModelError('DAILY_CAP', 'the daily call cap is used up');
    }
    if (this.counter.tokens >= this.maxTokens) {
      throw new ModelError('DAILY_CAP', 'the daily token cap is used up');
    }
    if (this.counter.usd + estimateUsd > this.maxUsd) {
      throw new ModelError('DAILY_CAP', 'the daily dollar cap would be exceeded');
    }
    this.counter.calls += 1;
    this.counter.usd += estimateUsd;
    this.save();
  }

  /**
   * Settles a finished attempt: adds the tokens it reported, and replaces its reserved worst case with its actual cost.
   * An attempt that reported no tokens adds none, and keeps its reserved cost.
   */
  settle(tokens: number, estimateUsd = 0, actualUsd = estimateUsd): void {
    this.roll();
    this.counter.tokens += Math.max(0, Math.floor(tokens));
    this.counter.usd = Math.max(0, this.counter.usd - estimateUsd + Math.max(0, actualUsd));
    this.save();
  }

  snapshot(): {
    readonly day: string;
    readonly calls: number;
    readonly tokens: number;
    readonly usd: number;
  } {
    this.roll();
    return {
      day: this.counter.day,
      calls: this.counter.calls,
      tokens: this.counter.tokens,
      usd: this.counter.usd,
    };
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** Starts a new count when the UTC day has changed. */
  private roll(): void {
    const day = this.today();
    if (this.counter.day !== day) {
      this.counter = { day, calls: 0, tokens: 0, usd: 0 };
      this.save();
    }
  }

  private load(): Counter {
    const fresh: Counter = { day: this.today(), calls: 0, tokens: 0, usd: 0 };
    if (this.file === null || !existsSync(this.file)) {
      return fresh;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
    } catch {
      throw new RangeError('the daily cap file cannot be read; fix or remove it to continue');
    }
    const usd: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'usd') : undefined;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof Reflect.get(parsed, 'day') !== 'string' ||
      !Number.isSafeInteger(Reflect.get(parsed, 'calls')) ||
      !Number.isSafeInteger(Reflect.get(parsed, 'tokens')) ||
      typeof usd !== 'number' ||
      !Number.isFinite(usd) ||
      usd < 0
    ) {
      throw new RangeError(
        'the daily cap file has an unexpected shape; fix or remove it to continue',
      );
    }
    const day = String(Reflect.get(parsed, 'day'));
    if (day !== fresh.day) {
      return fresh;
    }
    return {
      day,
      calls: Number(Reflect.get(parsed, 'calls')),
      tokens: Number(Reflect.get(parsed, 'tokens')),
      usd,
    };
  }

  private save(): void {
    if (this.file === null) {
      return;
    }
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.counter)}\n`, 'utf8');
    renameSync(temp, this.file);
  }
}
