import { describe, expect, it } from 'vitest';

import { AGENT_POLICY_VERSION, assertDataAllowed, chooseModel, keyFor } from '../src/config.js';
import { PROVIDERS } from '../src/model/providers.js';

describe('chooseModel', () => {
  it('uses the provider default when no model is named', () => {
    const choice = chooseModel('openrouter', undefined);
    expect(choice.model).toBe(PROVIDERS.openrouter.defaultModel);
    expect(choice.provider.id).toBe('openrouter');
  });

  it('accepts a named model from either provider, including a Meta model', () => {
    expect(chooseModel('huggingface', 'meta-llama/Llama-3.3-70B-Instruct:novita').model).toBe(
      'meta-llama/Llama-3.3-70B-Instruct:novita',
    );
    expect(chooseModel('openrouter', 'meta-llama/llama-3.3-70b-instruct').model).toBe(
      'meta-llama/llama-3.3-70b-instruct',
    );
  });

  it('refuses an unknown provider and an Anthropic model', () => {
    expect(() => chooseModel('someone', undefined)).toThrow('unknown model provider');
    expect(() => chooseModel('openrouter', 'anthropic/claude-opus-5-5')).toThrow(
      'Anthropic and Claude models are not used by this project',
    );
  });

  it('records a policy version in the format the Warden expects', () => {
    expect(AGENT_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d{1,4}$/);
  });
});

describe('assertDataAllowed', () => {
  const paid = chooseModel('huggingface', undefined);
  const free = chooseModel('openrouter', undefined);

  it('lets fictional data go to any allowed model', () => {
    expect(() => {
      assertDataAllowed({ dataClass: 'fictional', choice: free, zeroRetentionAck: null });
    }).not.toThrow();
  });

  it('refuses real invoices unless the provider is confirmed', () => {
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: paid, zeroRetentionAck: null });
    }).toThrow('--zero-retention-ack huggingface');
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: paid, zeroRetentionAck: 'openrouter' });
    }).toThrow('--zero-retention-ack huggingface');
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: paid, zeroRetentionAck: 'huggingface' });
    }).not.toThrow();
  });

  it('never sends real invoices to a free-tier model, even when the provider is confirmed', () => {
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: free, zeroRetentionAck: 'openrouter' });
    }).toThrow('a free-tier model is not used for real invoices');
  });
});

describe('keyFor', () => {
  it('reads the key from the environment, and names only the variable when it is missing', () => {
    expect(keyFor(PROVIDERS.openrouter, { OPENROUTER_API_KEY: '  placeholder-value  ' })).toBe(
      'placeholder-value',
    );
    expect(() => keyFor(PROVIDERS.huggingface, {})).toThrow(
      'set HF_TOKEN in your environment to use huggingface',
    );
    expect(() => keyFor(PROVIDERS.openrouter, { OPENROUTER_API_KEY: '   ' })).toThrow(
      'set OPENROUTER_API_KEY in your environment',
    );
  });
});
