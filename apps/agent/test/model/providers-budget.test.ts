import { describe, expect, it } from 'vitest';

import {
  budgetedModel,
  BudgetExhaustedError,
  MAX_MODEL_CALLS,
  ModelBudget,
} from '../../src/model/budget.js';
import { keyFor } from '../../src/config.js';
import {
  assertModelAllowed,
  baseUrlOf,
  PROVIDERS,
  providerById,
} from '../../src/model/providers.js';
import type { ModelClient, ModelRequest } from '../../src/model/types.js';

const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'x' }],
  maxTokens: 10,
  replySchema: null,
};

describe('providers', () => {
  it('finds each provider by identifier', () => {
    expect(providerById('openrouter')).toBe(PROVIDERS.openrouter);
    expect(providerById('groq')).toBe(PROVIDERS.groq);
    expect(providerById('gemini')).toBe(PROVIDERS.gemini);
    expect(providerById('meta')).toBe(PROVIDERS.meta);
    expect(providerById('aiml')).toBe(PROVIDERS.aiml);
    expect(providerById('huggingface')).toBe(PROVIDERS.huggingface);
  });

  it('refuses an unknown provider, a provider name that is not an identifier, and a prototype key', () => {
    expect(() => providerById('anthropic')).toThrow('unknown model provider');
    expect(() => providerById('hf')).toThrow('unknown model provider');
    expect(() => providerById('__proto__')).toThrow('unknown model provider');
  });

  it('names the key variable for each provider and never a key value', () => {
    expect(PROVIDERS.openrouter.keyEnv).toBe('OPENROUTER_API_KEY');
    expect(PROVIDERS.groq.keyEnv).toBe('GROQ_API_KEY');
    expect(PROVIDERS.gemini.keyEnv).toBe('GEMINI_API_KEY');
    expect(PROVIDERS.meta.keyEnv).toBe('META_API_KEY');
    expect(PROVIDERS.aiml.keyEnv).toBe('AIML_API_KEY');
    expect(PROVIDERS.huggingface.keyEnv).toBe('HF_TOKEN');
  });

  it('gives the AI/ML API and Hugging Face their documented base URLs, with a fixed address', () => {
    expect(PROVIDERS.aiml.baseUrl).toBe('https://api.aimlapi.com/v1');
    expect(PROVIDERS.aiml.baseUrlEnv).toBeNull();
    expect(baseUrlOf(PROVIDERS.aiml, {})).toBe('https://api.aimlapi.com/v1');
    expect(PROVIDERS.huggingface.baseUrl).toBe('https://router.huggingface.co/v1');
    expect(PROVIDERS.huggingface.baseUrlEnv).toBeNull();
    expect(baseUrlOf(PROVIDERS.huggingface, {})).toBe('https://router.huggingface.co/v1');
  });

  it('marks the AI/ML API and Hugging Face defaults UNVERIFIED in their access notes', () => {
    expect(PROVIDERS.aiml.accessNote).toContain('UNVERIFIED');
    expect(PROVIDERS.huggingface.accessNote).toContain('UNVERIFIED');
    expect(PROVIDERS.aiml.accessNote).toContain('https://aimlapi.com/app/sign-up');
    expect(PROVIDERS.huggingface.accessNote).toContain(
      'https://huggingface.co/settings/tokens/new',
    );
  });

  it('names HF_TOKEN, and never a value, when the Hugging Face or AI/ML API key is missing', () => {
    expect(() => keyFor(PROVIDERS.huggingface, {})).toThrow(
      'set HF_TOKEN in your environment to use huggingface',
    );
    expect(() => keyFor(PROVIDERS.aiml, { AIML_API_KEY: '   ' })).toThrow(
      'set AIML_API_KEY in your environment to use aiml',
    );
    expect(keyFor(PROVIDERS.aiml, { AIML_API_KEY: '  placeholder-value  ' })).toBe(
      'placeholder-value',
    );
  });

  it('accepts the default model of every provider', () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(() => {
        assertModelAllowed(provider.defaultModel);
      }).not.toThrow();
    }
  });

  it('refuses Anthropic and Claude models in any letter case', () => {
    expect(() => {
      assertModelAllowed('anthropic/claude-opus-5-5');
    }).toThrow('Anthropic and Claude models are not used by this project');
    expect(() => {
      assertModelAllowed('Some-Vendor/CLAUDE-like');
    }).toThrow('Anthropic and Claude models are not used by this project');
  });

  it('refuses identifiers with spaces, newlines or other unexpected characters', () => {
    expect(() => {
      assertModelAllowed('meta llama');
    }).toThrow('the model identifier has characters or a length that is not allowed');
    expect(() => {
      assertModelAllowed('model\nX-Header: y');
    }).toThrow('the model identifier has characters or a length that is not allowed');
    expect(() => {
      assertModelAllowed('');
    }).toThrow('the model identifier has characters or a length that is not allowed');
    expect(() => {
      assertModelAllowed('a'.repeat(201));
    }).toThrow('the model identifier has characters or a length that is not allowed');
  });
});

describe('baseUrlOf', () => {
  it('returns the fixed address of a provider that publishes one', () => {
    expect(baseUrlOf(PROVIDERS.groq, {})).toBe('https://api.groq.com/openai/v1');
    expect(baseUrlOf(PROVIDERS.gemini, {})).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
  });

  it("reads Meta's address from its variable, without a trailing slash", () => {
    expect(
      baseUrlOf(PROVIDERS.meta, { META_API_BASE_URL: 'https://meta.example.test/compat/v1/' }),
    ).toBe('https://meta.example.test/compat/v1');
  });

  it('names only the variable when the Meta address is missing, unsafe or malformed', () => {
    expect(() => baseUrlOf(PROVIDERS.meta, {})).toThrow(
      'set META_API_BASE_URL in your environment to use meta',
    );
    expect(() => baseUrlOf(PROVIDERS.meta, { META_API_BASE_URL: '   ' })).toThrow(
      'set META_API_BASE_URL in your environment',
    );
    expect(() => baseUrlOf(PROVIDERS.meta, { META_API_BASE_URL: 'not a url' })).toThrow(
      'META_API_BASE_URL is not a valid address',
    );
    for (const unsafe of [
      'http://meta.example.test/v1',
      'https://someone@meta.example.test/v1',
      'https://meta.example.test/v1?token=1',
      'https://meta.example.test/v1#part',
    ]) {
      expect(() => baseUrlOf(PROVIDERS.meta, { META_API_BASE_URL: unsafe })).toThrow(
        'META_API_BASE_URL must be an https address with no credentials, query or fragment',
      );
    }
  });
});

describe('ModelBudget', () => {
  it('allows the limit and then refuses, so a call cannot happen uncounted', () => {
    const budget = new ModelBudget();
    expect(budget.limit).toBe(MAX_MODEL_CALLS);
    budget.spend();
    budget.spend();
    budget.spend();
    expect(budget.callsUsed).toBe(3);
    expect(() => {
      budget.spend();
    }).toThrow(BudgetExhaustedError);
    expect(budget.callsUsed).toBe(3);
  });

  it('accepts a smaller limit', () => {
    const budget = new ModelBudget(1);
    budget.spend();
    expect(() => {
      budget.spend();
    }).toThrow('the model budget of 1 calls is used up');
  });

  it('refuses a limit outside one to three', () => {
    expect(() => new ModelBudget(0)).toThrow('the model budget must be between 1 and 3');
    expect(() => new ModelBudget(4)).toThrow('the model budget must be between 1 and 3');
    expect(() => new ModelBudget(1.5)).toThrow('the model budget must be between 1 and 3');
  });
});

describe('budgetedModel', () => {
  function countingClient(): ModelClient & { readonly calls: number } {
    const state = { calls: 0 };
    return {
      label: 'test:model',
      get calls() {
        return state.calls;
      },
      complete() {
        state.calls += 1;
        return Promise.resolve({ text: '{}' });
      },
    };
  }

  it('counts each call before it reaches the client and keeps the client label', async () => {
    const inner = countingClient();
    const budget = new ModelBudget(2);
    const wrapped = budgetedModel(inner, budget);
    expect(wrapped.label).toBe('test:model');
    await wrapped.complete(REQUEST);
    await wrapped.complete(REQUEST);
    expect(inner.calls).toBe(2);
    await expect(wrapped.complete(REQUEST)).rejects.toThrow(BudgetExhaustedError);
    expect(inner.calls).toBe(2);
    expect(budget.callsUsed).toBe(2);
  });
});
