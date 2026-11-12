/**
 * The model providers the agent may use, in the order a live run tries them (see FAILOVER_ORDER). Each speaks the
 * OpenAI-compatible chat completions API over HTTPS, so the agent needs no provider SDK. Anthropic's own models are
 * excluded by project policy (user instruction, 2026-11-10).
 *
 * Every default model was checked against that provider's live model list on 2026-11-12. Model lists and free tiers
 * change, so check an identifier again before a live run. Each key is read from its environment variable at run time
 * only. Meta's address is set by the operator in META_API_BASE_URL, because it is not a fixed public address.
 *
 * Structured output: a schema reply format is requested only where the provider's documentation says it is supported
 * (see schemaReply and capabilitiesOf). Everywhere else no reply format is requested, and the reply is validated in
 * code, so an unsupported request is never sent.
 */

export type ProviderId = 'openrouter' | 'groq' | 'gemini' | 'meta' | 'aiml' | 'hf';

export interface ProviderDefinition {
  readonly id: ProviderId;
  /** A fixed base URL, or null when the operator sets the address in the variable named by baseUrlEnv. */
  readonly baseUrl: string | null;
  readonly baseUrlEnv: string | null;
  readonly keyEnv: string;
  readonly defaultModel: string;
  /** True when the provider documents a json_schema response_format for chat completions. */
  readonly schemaReply: boolean;
  /**
   * Request fields that keep a reasoning model from spending the whole token budget on reasoning, so the reply is not
   * cut off. Each field is named in docs/logs/DECISION-JOURNAL.md (D-100) with the probe that showed it was needed.
   */
  readonly requestExtras: Readonly<Record<string, unknown>>;
  /** List price in US dollars per million tokens, as its own catalogue showed it on 2026-11-12, or null if none was read. */
  readonly listPrice: { readonly input: number; readonly output: number } | null;
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
    // OpenRouter lists supported_parameters per model. For this model the list has reasoning and reasoning_effort but
    // not response_format, so no schema is requested. The rule is per model, see capabilitiesOf.
    schemaReply: false,
    requestExtras: { reasoning: { effort: 'low' } },
    listPrice: { input: 0, output: 0 },
    accessNote:
      'Free-tier model. Its data handling is set by OpenRouter and the model host, and is not verified here.',
  },
  groq: {
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    baseUrlEnv: null,
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    // Groq documents json_schema. Its page lists strict mode for some models and best-effort for others, and conflicts
    // on the 120B model, so the schema is sent without strict: true and every reply is validated in code.
    schemaReply: true,
    requestExtras: { reasoning_effort: 'low' },
    listPrice: { input: 0.15, output: 0.6 },
    accessNote:
      'Groq hosted model. Its free-tier limits and data handling are set by Groq and are not verified here.',
  },
  gemini: {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    baseUrlEnv: null,
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash',
    schemaReply: true,
    requestExtras: { reasoning_effort: 'low' },
    listPrice: { input: 1.5, output: 9 },
    accessNote:
      'Google Gemini API through its OpenAI-compatible endpoint. Free-tier data handling is set by Google and is not verified here.',
  },
  meta: {
    id: 'meta',
    baseUrl: null,
    baseUrlEnv: 'META_API_BASE_URL',
    keyEnv: 'META_API_KEY',
    // Checked on 2026-11-12 against Meta's own /models list. muse-ember-1.0 is the cheapest Meta model in the OpenRouter
    // catalogue that lists structured output (its price is used below); it answered a schema request with valid JSON when
    // reasoning_effort was low. The previous default, muse-spark-1.3, costs about twelve times as much per token.
    defaultModel: 'muse-ember-1.0',
    schemaReply: true,
    requestExtras: { reasoning_effort: 'low' },
    listPrice: { input: 0.1, output: 0.5 },
    accessNote:
      'Meta API, paid credit. Its address comes from META_API_BASE_URL. Its access terms and data handling are set by Meta and are not verified here. The price is the OpenRouter list price for the same model, a proxy because Meta publishes no price in its /models list.',
  },
  aiml: {
    id: 'aiml',
    baseUrl: 'https://api.aimlapi.com/v1',
    baseUrlEnv: null,
    keyEnv: 'AIML_API_KEY',
    defaultModel: 'meta/muse-spark-1.3',
    schemaReply: false,
    requestExtras: {},
    listPrice: null,
    accessNote:
      'AI/ML API hosted model. Its terms and data handling are set by the provider and are not verified here.',
  },
  hf: {
    id: 'hf',
    baseUrl: 'https://router.huggingface.co/v1',
    baseUrlEnv: null,
    keyEnv: 'HF_TOKEN',
    defaultModel: 'openai/gpt-oss-120b',
    schemaReply: false,
    requestExtras: {},
    listPrice: null,
    accessNote:
      'Hugging Face router. The serving provider behind each route sets its data handling, which is not verified here.',
  },
} as const satisfies Readonly<Record<ProviderId, ProviderDefinition>>;

/** The order a live run tries providers in: the cheapest first. Only a provider with its key set is used. */
export const FAILOVER_ORDER: readonly ProviderId[] = [
  // Meta first: it is the funded provider (paid credit, $5 at 2026-11-12), and it is priced, so the spend caps can bound it.
  'meta',
  'openrouter',
  'groq',
  'gemini',
  'aiml',
  'hf',
];

const BY_ID: ReadonlyMap<string, ProviderDefinition> = new Map<string, ProviderDefinition>(
  Object.values(PROVIDERS).map((provider) => [provider.id, provider]),
);

export function providerById(id: string): ProviderDefinition {
  const provider = BY_ID.get(id);
  if (provider === undefined) {
    throw new RangeError('unknown model provider');
  }
  return provider;
}

/**
 * Whether a provider and a model may be sent a schema reply format. OpenRouter answers per model, and the default
 * model is recorded as not supporting it, so any OpenRouter model is treated as not supporting it unless it is added
 * here with its supported-parameter list as the source.
 */
export function capabilitiesOf(
  provider: ProviderDefinition,
  model: string,
): { readonly schemaReply: boolean } {
  if (provider.id === 'openrouter') {
    return { schemaReply: false };
  }
  return { schemaReply: provider.schemaReply && model.length > 0 };
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
