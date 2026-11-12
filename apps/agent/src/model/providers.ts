/**
 * The model providers the agent may use. Each speaks the OpenAI-compatible chat completions API over HTTPS, so the agent
 * needs no provider SDK. Anthropic's own models are excluded by project policy (user instruction, 2026-11-10).
 *
 * The default models of the first four were read from each provider's public model list on 2026-11-10. The AI/ML API
 * and Hugging Face entries were read from their public docs on 2026-11-12, and their default models are UNVERIFIED for
 * price and structured output (see each access note). Model lists and free tiers change, so re-check an identifier
 * before a live run. Each key is read from its environment variable at run time only. Meta's address is set by the
 * operator in META_API_BASE_URL, because it is not a fixed public address.
 */

export type ProviderId = 'openrouter' | 'groq' | 'gemini' | 'meta' | 'aiml' | 'huggingface';

export interface ProviderDefinition {
  readonly id: ProviderId;
  /** A fixed base URL, or null when the operator sets the address in the variable named by baseUrlEnv. */
  readonly baseUrl: string | null;
  readonly baseUrlEnv: string | null;
  readonly keyEnv: string;
  readonly defaultModel: string;
  /** What is known about the access terms. Data handling is set by the provider, and this project does not verify it. */
  readonly accessNote: string;
}

export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnv: null,
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    accessNote:
      'Free-tier model. Its data handling is set by OpenRouter and the model host, and is not verified here.',
  },
  groq: {
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    baseUrlEnv: null,
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    accessNote:
      'Groq hosted model. Its free-tier limits and data handling are set by Groq and are not verified here.',
  },
  gemini: {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    baseUrlEnv: null,
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash',
    accessNote:
      'Google Gemini API through its OpenAI-compatible endpoint. Free-tier data handling is set by Google and is not verified here.',
  },
  meta: {
    id: 'meta',
    baseUrl: null,
    baseUrlEnv: 'META_API_BASE_URL',
    keyEnv: 'META_API_KEY',
    defaultModel: 'muse-spark-1.3',
    accessNote:
      'Meta API. Its address comes from META_API_BASE_URL. Its access terms and data handling are set by Meta and are not verified here.',
  },
  aiml: {
    id: 'aiml',
    baseUrl: 'https://api.aimlapi.com/v1',
    baseUrlEnv: null,
    keyEnv: 'AIML_API_KEY',
    // UNVERIFIED: the id is the one the AI/ML API docs use in their own examples (read 2026-11-12). The docs do not say
    // it is cheap or free, and do not say it supports JSON or structured output. Check both before any live run.
    defaultModel: 'google/gemma-3-4b-it',
    accessNote:
      'UNVERIFIED: AI/ML API, OpenAI-compatible. Sign up at https://aimlapi.com/app/sign-up and create a key at https://aimlapi.com/app/keys. The docs read 2026-11-12 do not state a free tier, and the default model is not confirmed as cheap or as supporting structured output. Data handling is set by the provider and is not verified here.',
  },
  huggingface: {
    id: 'huggingface',
    baseUrl: 'https://router.huggingface.co/v1',
    baseUrlEnv: null,
    keyEnv: 'HF_TOKEN',
    // UNVERIFIED: the model id and the ':cheapest' provider suffix are from the Inference Providers docs (read
    // 2026-11-12). The docs show no price for this model, so it is not confirmed as free or cheap, and its JSON support
    // is not confirmed per model.
    defaultModel: 'openai/gpt-oss-120b:cheapest',
    accessNote:
      'UNVERIFIED: Hugging Face Inference Providers router, OpenAI-compatible. Create a fine-grained token with the Inference Providers permission at https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained. The docs read 2026-11-12 state pay-as-you-go pricing with monthly credits for PRO users, and no free tier for other accounts. Data handling is set by the provider and is not verified here.',
  },
} as const satisfies Readonly<Record<ProviderId, ProviderDefinition>>;

const BY_ID: ReadonlyMap<string, ProviderDefinition> = new Map<string, ProviderDefinition>([
  [PROVIDERS.openrouter.id, PROVIDERS.openrouter],
  [PROVIDERS.groq.id, PROVIDERS.groq],
  [PROVIDERS.gemini.id, PROVIDERS.gemini],
  [PROVIDERS.meta.id, PROVIDERS.meta],
  [PROVIDERS.aiml.id, PROVIDERS.aiml],
  [PROVIDERS.huggingface.id, PROVIDERS.huggingface],
]);

export function providerById(id: string): ProviderDefinition {
  const provider = BY_ID.get(id);
  if (provider === undefined) {
    throw new RangeError('unknown model provider');
  }
  return provider;
}

/**
 * The base URL a provider is called at. A fixed address is returned as it is. Meta's address comes from the operator's
 * environment and must be an https address with no credentials, query or fragment. Messages name the variable and
 * never its value.
 */
export function baseUrlOf(provider: ProviderDefinition, env: NodeJS.ProcessEnv): string {
  if (provider.baseUrl !== null) {
    return provider.baseUrl;
  }
  const name = provider.baseUrlEnv ?? '';
  const raw: unknown = Reflect.get(env, name);
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) {
    throw new RangeError(`set ${name} in your environment to use ${provider.id}`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError(`${name} is not a valid address`);
  }
  const plain = url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  if (url.protocol !== 'https:' || !plain) {
    throw new RangeError(`${name} must be an https address with no credentials, query or fragment`);
  }
  return url.href.replace(/\/+$/, '');
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
