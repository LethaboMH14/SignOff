import { describe, expect, it } from 'vitest';

import {
  budgetedModel,
  BudgetExhaustedError,
  MAX_MODEL_CALLS,
  ModelBudget,
} from '../../src/model/budget.js';
import { assertModelAllowed, PROVIDERS, providerById } from '../../src/model/providers.js';
import type { ModelClient, ModelRequest } from '../../src/model/types.js';

const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'x' }],
  maxTokens: 10,
  replySchema: null,
};

describe('providers', () => {
  it('finds each provider by identifier', () => {
    expect(providerById('openrouter')).toBe(PROVIDERS.openrouter);
    expect(providerById('huggingface')).toBe(PROVIDERS.huggingface);
  });

  it('refuses an unknown provider', () => {
    expect(() => providerById('anthropic')).toThrow('unknown model provider');
    expect(() => providerById('__proto__')).toThrow('unknown model provider');
  });

  it('names the key variable for each provider and never a key value', () => {
    expect(PROVIDERS.openrouter.keyEnv).toBe('OPENROUTER_API_KEY');
    expect(PROVIDERS.huggingface.keyEnv).toBe('HF_TOKEN');
  });

  it('accepts the default models and Meta models on OpenRouter', () => {
    expect(() => {
      assertModelAllowed(PROVIDERS.openrouter.defaultModel);
    }).not.toThrow();
    expect(() => {
      assertModelAllowed(PROVIDERS.huggingface.defaultModel);
    }).not.toThrow();
    expect(() => {
      assertModelAllowed('meta-llama/llama-3.3-70b-instruct');
    }).not.toThrow();
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
