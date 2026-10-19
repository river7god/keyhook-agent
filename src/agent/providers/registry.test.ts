import { describe, expect, it } from 'vitest';
import { llmRoutingSchema, parseModelRef } from './registry';

describe('llm routing config', () => {
  it('reads a deployment default from env, requiring acknowledgement for Kimi', async () => {
    const { envDefaultRouting } = await import('.');
    // Isolate from a developer's .env (vitest loads it).
    const saved = {
      model: process.env.LLM_DEFAULT_MODEL,
      ack: process.env.LLM_ACKNOWLEDGE_OFFSHORE,
      synthetic: process.env.LLM_SYNTHETIC_DATA_ONLY,
    };
    process.env.LLM_SYNTHETIC_DATA_ONLY = 'true';
    delete process.env.LLM_ACKNOWLEDGE_OFFSHORE;
    process.env.LLM_DEFAULT_MODEL = 'moonshot:kimi-test';
    expect(() => envDefaultRouting()).toThrow(/acknowledgeOffshoreProviders/);
    process.env.LLM_ACKNOWLEDGE_OFFSHORE = 'true';
    expect(envDefaultRouting()?.default).toEqual({ provider: 'moonshot', model: 'kimi-test' });
    delete process.env.LLM_DEFAULT_MODEL;
    delete process.env.LLM_ACKNOWLEDGE_OFFSHORE;
    expect(envDefaultRouting()).toBeNull();
    if (saved.model !== undefined) process.env.LLM_DEFAULT_MODEL = saved.model;
    if (saved.ack !== undefined) process.env.LLM_ACKNOWLEDGE_OFFSHORE = saved.ack;
    if (saved.synthetic === undefined) delete process.env.LLM_SYNTHETIC_DATA_ONLY;
    else process.env.LLM_SYNTHETIC_DATA_ONLY = saved.synthetic;
  });

  it('routes step groups from LLM_STEP_MODELS, keeping Claude as the default', async () => {
    const { envDefaultRouting, parseStepModels, RoutingLlm } = await import('.');
    const saved = { ...process.env };
    try {
      delete process.env.LLM_DEFAULT_MODEL;
      delete process.env.LLM_VISION_MODEL;
      delete process.env.LLM_FALLBACK_MODEL;
      process.env.LLM_STEP_MODELS =
        'compose=anthropic:claude-haiku-5-5, interpret=anthropic:claude-haiku-5-5';
      const routing = envDefaultRouting();
      const llm = new RoutingLlm(null as never, routing);
      expect(llm.resolve('compose.tenant').model).toBe('claude-haiku-5-5');
      expect(llm.resolve('interpret.slot').model).toBe('claude-haiku-5-5');
      expect(llm.resolve('triage').model).toBe('claude-opus-5-5');
      expect(() => parseStepModels('compose')).toThrow(/step=provider:model/);
      process.env.LLM_STEP_MODELS = 'nonsense=anthropic:x';
      expect(() => envDefaultRouting()).toThrow();
    } finally {
      process.env = saved;
    }
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
      steps: { ops: { provider: 'deepseek', model: 'deepseek-chat' } },
    };
    expect(llmRoutingSchema.safeParse(cfg).success).toBe(false);
    expect(llmRoutingSchema.safeParse({ ...cfg, acknowledgeOffshoreProviders: true }).success).toBe(
      true,
    );
  });

  it('keeps personal data away from offshore providers unless the data is fictional', () => {
    const kimi = { provider: 'moonshot', model: 'kimi-k2.6' };
    const claude = { provider: 'anthropic', model: 'claude-opus-5-5' };
    const ack = { acknowledgeOffshoreProviders: true };
    const issues = (cfg: object) => {
      const r = llmRoutingSchema.safeParse(cfg);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    // Kimi as the default would carry every personal-data step offshore.
    expect(issues({ ...ack, default: kimi }).join()).toMatch(
      /"triage" handles personal information/,
    );
    // Same, if it is only the fallback for personal steps.
    expect(issues({ ...ack, default: claude, fallback: kimi }).join()).toMatch(/falls back to/);
    // Aggregates only (the Ops analyst) is fine with acknowledgement.
    expect(issues({ ...ack, default: claude, steps: { ops: kimi } })).toEqual([]);
    // Every personal step overridden to Claude: the offshore default is never used for them.
    const allClaude = Object.fromEntries(
      ['triage', 'retriage', 'act', 'interpret', 'compose', 'vision', 'route'].map((g) => [
        g,
        claude,
      ]),
    );
    expect(issues({ ...ack, default: kimi, steps: { ...allClaude } })).toEqual([]);
    // A deployment that holds only fictional data (dev, demo, eval) may use it everywhere.
    expect(issues({ ...ack, default: kimi, syntheticDataOnly: true })).toEqual([]);
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
