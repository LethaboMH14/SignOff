/**
 * Two kinds of memory, kept apart on purpose.
 *
 * Short-term: the scratch state of one invoice. It lives in the graph state and is checkpointed with it, and it ends when
 * the invoice reaches a terminal state.
 *
 * Long-term: supplier history and past decisions. These are read-only facts. The only way to add one is
 * recordValidatedOutcome, which takes a ValidatedOutcome. That value can be made only by validateOutcome, from a
 * terminal outcome and the hash of its log line. No model reply can produce one: model output is parsed by a strict
 * schema that has no memory field, and the swarm and judge modules never import the writer (a test checks this).
 */

export const TERMINAL_OUTCOMES = ['PAID', 'HELD', 'REFUSED', 'NEEDS_PERSON'] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

const SEALED: unique symbol = Symbol('validated-outcome');

export interface OutcomeInput {
  readonly supplierId: string;
  readonly invoiceFingerprint: string;
  readonly outcome: TerminalOutcome;
  readonly reasonCode: string;
  readonly policyVersion: string;
  readonly logLineSha256: string;
}

export interface ValidatedOutcome extends OutcomeInput {
  readonly [SEALED]: true;
}

export function validateOutcome(input: OutcomeInput): ValidatedOutcome {
  if (!/^[A-Z0-9_]{2,64}$/.test(input.reasonCode)) {
    throw new RangeError('the reason code is not in the allowed form');
  }
  if (
    !/^[0-9a-f]{64}$/.test(input.logLineSha256) ||
    !/^[0-9a-f]{64}$/.test(input.invoiceFingerprint)
  ) {
    throw new RangeError('the hashes must be SHA-256 hex');
  }
  if (!(TERMINAL_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new RangeError('only a terminal outcome can become a fact');
  }
  return Object.freeze({ ...input, [SEALED]: true as const });
}

export interface Fact {
  readonly supplierId: string;
  readonly invoiceFingerprint: string;
  readonly outcome: TerminalOutcome;
  readonly reasonCode: string;
  readonly policyVersion: string;
  readonly logLineSha256: string;
}

/** An immutable store. Adding a fact returns a new store, so an earlier snapshot never changes under a reader. */
export class LongTermFacts {
  private readonly facts: readonly Fact[];

  private constructor(facts: readonly Fact[]) {
    this.facts = facts;
  }

  static empty(): LongTermFacts {
    return new LongTermFacts([]);
  }

  get size(): number {
    return this.facts.length;
  }

  /** Facts for one supplier, in the order they were recorded. */
  historyOf(supplierId: string): readonly Fact[] {
    return this.facts.filter((fact) => fact.supplierId === supplierId);
  }

  /** Code-only writer, reached through recordValidatedOutcome. */
  withOutcome(outcome: ValidatedOutcome): LongTermFacts {
    const fact: Fact = {
      supplierId: outcome.supplierId,
      invoiceFingerprint: outcome.invoiceFingerprint,
      outcome: outcome.outcome,
      reasonCode: outcome.reasonCode,
      policyVersion: outcome.policyVersion,
      logLineSha256: outcome.logLineSha256,
    };
    return new LongTermFacts([...this.facts, fact]);
  }
}

export function recordValidatedOutcome(
  store: LongTermFacts,
  outcome: ValidatedOutcome,
): LongTermFacts {
  const sealed: unknown = Reflect.get(outcome, SEALED);
  if (sealed !== true) {
    throw new TypeError('only a validated outcome can be recorded');
  }
  return store.withOutcome(outcome);
}

/** Per-invoice scratch state. Values are frozen on the way in, so a later step cannot change what an earlier one wrote. */
export class ShortTermState {
  private readonly values = new Map<string, unknown>();

  put(key: string, value: unknown): void {
    if (this.values.has(key)) {
      throw new Error(`the scratch key ${key} is already set for this invoice`);
    }
    this.values.set(key, deepFreeze(value));
  }

  get(key: string): unknown {
    return this.values.get(key);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
