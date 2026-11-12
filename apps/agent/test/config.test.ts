import { describe, expect, it } from 'vitest';

import { AGENT_POLICY_VERSION, assertDataAllowed, chooseModel, keyFor } from '../src/config.js';
import { PROVIDERS } from '../src/model/providers.js';

describe('chooseModel', () => {
  it('uses the provider default when no model is named', () => {
    const choice = chooseModel('openrouter', undefined);
    expect(choice.model).toBe(PROVIDERS.openrouter.defaultModel);
    expect(choice.provider.id).toBe('openrouter');
  });

  it('accepts a named model from each provider', () => {
    expect(chooseModel('groq', 'openai/gpt-oss-20b').model).toBe('openai/gpt-oss-20b');
    expect(chooseModel('gemini', 'gemini-2.5-flash-lite').model).toBe('gemini-2.5-flash-lite');
    expect(chooseModel('meta', 'muse-spark-1.2').model).toBe('muse-spark-1.2');
  });

  it('accepts the AI/ML API and Hugging Face, with their defaults', () => {
    expect(chooseModel('aiml', undefined).model).toBe(PROVIDERS.aiml.defaultModel);
    expect(chooseModel('huggingface', undefined).model).toBe(PROVIDERS.huggingface.defaultModel);
    expect(chooseModel('huggingface', 'openai/gpt-oss-20b:cheapest').provider.id).toBe(
      'huggingface',
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
  const paid = chooseModel('groq', undefined);
  const free = chooseModel('openrouter', undefined);

  it('lets fictional data go to any allowed model', () => {
    expect(() => {
      assertDataAllowed({ dataClass: 'fictional', choice: free, zeroRetentionAck: null });
    }).not.toThrow();
  });

  it('refuses real invoices unless the provider is confirmed', () => {
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: paid, zeroRetentionAck: null });
    }).toThrow('--zero-retention-ack groq');
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: paid, zeroRetentionAck: 'openrouter' });
    }).toThrow('--zero-retention-ack groq');
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: paid, zeroRetentionAck: 'groq' });
    }).not.toThrow();
  });

  it('never sends real invoices to a free-tier model, even when the provider is confirmed', () => {
    expect(() => {
      assertDataAllowed({ dataClass: 'real', choice: free, zeroRetentionAck: 'openrouter' });
    }).toThrow('a free-tier model is not used for real invoices');
  });
});

describe('keyFor', () => {
  it('reads the key for the new providers from their variables, and names only the variable', () => {
    expect(keyFor(PROVIDERS.huggingface, { HF_TOKEN: '  placeholder-value  ' })).toBe(
      'placeholder-value',
    );
    expect(() => keyFor(PROVIDERS.aiml, {})).toThrow(
      'set AIML_API_KEY in your environment to use aiml',
    );
  });

  it('reads the key from the environment, and names only the variable when it is missing', () => {
    expect(keyFor(PROVIDERS.openrouter, { OPENROUTER_API_KEY: '  placeholder-value  ' })).toBe(
      'placeholder-value',
    );
    expect(() => keyFor(PROVIDERS.groq, {})).toThrow(
      'set GROQ_API_KEY in your environment to use groq',
    );
    expect(() => keyFor(PROVIDERS.openrouter, { OPENROUTER_API_KEY: '   ' })).toThrow(
      'set OPENROUTER_API_KEY in your environment',
    );
  });
});
