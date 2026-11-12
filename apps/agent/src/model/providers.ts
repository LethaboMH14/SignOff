/**
 * The model providers the agent may use. Both speak the OpenAI-compatible chat completions API over HTTPS, so the
 * agent needs no provider SDK. Anthropic's own models are excluded by project policy (user instruction, 2026-11-10).
 *
 * The defaults below were read from the providers' public model lists on 2026-11-10. Free and credit-funded offers
 * change, so re-check a model identifier before a live run. The key for each provider is read from its environment
 * variable at run time only.
 */

export type ProviderId = 'openrouter' | 'huggingface';

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly baseUrl: string;
  readonly keyEnv: string;
  readonly defaultModel: string;
  /** What is known about the access terms. Data handling is set by the provider, and this project does not verify it. */
  readonly accessNote: string;
}

export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'google/gemma-4-31b-it:free',
    accessNote:
      'Free-tier model. Its data handling is set by OpenRouter and the model host, and is not verified here.',
  },
  huggingface: {
    id: 'huggingface',
    baseUrl: 'https://router.huggingface.co/v1',
    keyEnv: 'HF_TOKEN',
    defaultModel: 'google/gemma-4-31B-it:deepinfra',
    accessNote:
      'Pay-as-you-go routing with included monthly credits. No provider was flagged free on 2026-11-10. Its data handling is set by the provider, and is not verified here.',
  },
} as const satisfies Readonly<Record<ProviderId, ProviderDefinition>>;

const BY_ID: ReadonlyMap<string, ProviderDefinition> = new Map<string, ProviderDefinition>([
  [PROVIDERS.openrouter.id, PROVIDERS.openrouter],
  [PROVIDERS.huggingface.id, PROVIDERS.huggingface],
]);

export function providerById(id: string): ProviderDefinition {
  const provider = BY_ID.get(id);
  if (provider === undefined) {
    throw new RangeError('unknown model provider');
  }
  return provider;
}

const MODEL_ID = /^[A-Za-z0-9._/:-]{1,200}$/;

/** Rejects malformed identifiers and every Anthropic or Claude model. */
export function assertModelAllowed(model: string): void {
  if (!MODEL_ID.test(model)) {
    throw new RangeError('the model identifier has characters or a length that is not allowed');
  }
  const lower = model.toLowerCase();
  if (lower.startsWith('anthropic/') || lower.includes('claude')) {
    throw new RangeError('Anthropic and Claude models are not used by this project');
  }
}
