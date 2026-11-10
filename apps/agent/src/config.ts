import { assertModelAllowed, providerById, type ProviderDefinition } from './model/providers.js';

/**
 * Run configuration: which model, which data, and the rules that connect them. Keys are read from the environment at
 * run time and are never stored, printed or written to the log.
 */

/** The policy version recorded with every decision. It changes when a rule in this agent changes meaning. */
export const AGENT_POLICY_VERSION = '2026-11-10.1';

export type DataClass = 'fictional' | 'real';

export interface ModelChoice {
  readonly provider: ProviderDefinition;
  readonly model: string;
}

export function chooseModel(providerId: string, model: string | undefined): ModelChoice {
  const provider = providerById(providerId);
  const chosen = model ?? provider.defaultModel;
  assertModelAllowed(chosen);
  return { provider, model: chosen };
}

export interface DataPolicyInput {
  readonly dataClass: DataClass;
  readonly choice: ModelChoice;
  /** The provider the operator has confirmed has zero-retention terms for real invoices, or null. */
  readonly zeroRetentionAck: string | null;
}

/**
 * Real invoices may reach a model only when the operator has confirmed that provider's data terms. A free-tier model
 * (its identifier ends in ":free") is never taken to keep data private, so it is refused for real invoices.
 */
export function assertDataAllowed(input: DataPolicyInput): void {
  if (input.dataClass === 'fictional') {
    return;
  }
  if (input.choice.model.endsWith(':free')) {
    throw new RangeError('a free-tier model is not used for real invoices');
  }
  if (input.zeroRetentionAck !== input.choice.provider.id) {
    throw new RangeError(
      `real invoices may be sent to ${input.choice.provider.id} only after its zero-retention terms are confirmed (--zero-retention-ack ${input.choice.provider.id})`,
    );
  }
}

/** The provider's key, from its environment variable. The message names the variable and never its value. */
export function keyFor(provider: ProviderDefinition, env: NodeJS.ProcessEnv): string {
  const value = env[provider.keyEnv];
  if (value === undefined || value.trim().length === 0) {
    throw new RangeError(`set ${provider.keyEnv} in your environment to use ${provider.id}`);
  }
  return value.trim();
}
