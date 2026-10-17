import { describe, expect, it } from 'vitest';
import { llmRoutingSchema, parseModelRef } from './registry';

describe('llm routing config', () => {
  it('reads a deployment default from env, requiring acknowledgement for Kimi', async () => {
    const { envDefaultRouting } = await import('.');
    process.env.LLM_DEFAULT_MODEL = 'moonshot:kimi-test';
    expect(() => envDefaultRouting()).toThrow(/acknowledgeOffshoreProviders/);
    process.env.LLM_ACKNOWLEDGE_OFFSHORE = 'true';
    expect(envDefaultRouting()?.default).toEqual({ provider: 'moonshot', model: 'kimi-test' });
    delete process.env.LLM_DEFAULT_MODEL;
    delete process.env.LLM_ACKNOWLEDGE_OFFSHORE;
    expect(envDefaultRouting()).toBeNull();
  });

  it('accepts Claude-only and OpenAI routing without acknowledgement', () => {
    expect(
      llmRoutingSchema.safeParse({
        default: { provider: 'anthropic', model: 'claude-opus-5-5' },
        steps: { compose: { provider: 'openai', model: 'gpt-x' } },
      }).success,
    ).toBe(true);
  });

  it('refuses DeepSeek / Kimi unless offshore processing is acknowledged', () => {
    const cfg = {
      default: { provider: 'anthropic', model: 'claude-opus-5-5' },
      steps: { interpret: { provider: 'deepseek', model: 'deepseek-chat' } },
    };
    expect(llmRoutingSchema.safeParse(cfg).success).toBe(false);
    expect(llmRoutingSchema.safeParse({ ...cfg, acknowledgeOffshoreProviders: true }).success).toBe(
      true,
    );
  });

  it('rejects unknown providers and step groups', () => {
    expect(llmRoutingSchema.safeParse({ default: { provider: 'acme', model: 'x' } }).success).toBe(
      false,
    );
    expect(
      llmRoutingSchema.safeParse({
        default: { provider: 'anthropic', model: 'x' },
        steps: { everything: { provider: 'openai', model: 'y' } },
      }).success,
    ).toBe(false);
  });

  it('parses provider:model references', () => {
    expect(parseModelRef('moonshot:kimi-k2:latest')).toEqual({
      provider: 'moonshot',
      model: 'kimi-k2:latest',
    });
    expect(() => parseModelRef('nope')).toThrow();
  });
});
