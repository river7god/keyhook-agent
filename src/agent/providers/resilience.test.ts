import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DbOrTx } from '@/db/client';
import { LlmConfigError, LlmOutputError, LlmRefusalError, type LlmClient } from '../llm';
import { stepTimeoutMs } from '../timeouts';
import { RoutingLlm } from './index';
import type { LlmRouting, ModelRef } from './registry';
import { CircuitBreaker, resetBreakers, shouldFailOver } from './resilience';

describe('CircuitBreaker', () => {
  it('opens after 3 failures in a minute, half-opens for one trial, closes on success', () => {
    let t = 0;
    const b = new CircuitBreaker(3, 60_000, 60_000, () => t);
    b.failure();
    t = 70_000; // first failure falls out of the window
    b.failure();
    b.failure();
    expect(b.state).toBe('closed');
    b.failure();
    expect(b.state).toBe('open');
    expect(b.allow()).toBe(false);
    t += 60_000;
    expect(b.state).toBe('half-open');
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(false); // only one trial at a time
    b.failure();
    expect(b.state).toBe('open');
    t += 60_000;
    expect(b.allow()).toBe(true);
    b.success();
    expect(b.state).toBe('closed');
  });
});

describe('shouldFailOver', () => {
  it('fails over on provider trouble, not on what the model said', () => {
    expect(shouldFailOver(new LlmConfigError('no key'))).toBe(true);
    expect(shouldFailOver(new Anthropic.APIConnectionTimeoutError())).toBe(true);
    expect(shouldFailOver(new OpenAI.APIConnectionError({ message: 'reset' }))).toBe(true);
    expect(
      shouldFailOver(
        new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers()),
      ),
    ).toBe(true);
    expect(
      shouldFailOver(new OpenAI.RateLimitError(429, undefined, 'slow down', new Headers())),
    ).toBe(true);
    expect(shouldFailOver(new LlmRefusalError('cyber'))).toBe(false);
    expect(shouldFailOver(new LlmOutputError('bad json', 'end_turn'))).toBe(false);
    expect(shouldFailOver(new Error('bug'))).toBe(false);
  });
});

describe('stepTimeoutMs', () => {
  it('limits by step group', () => {
    expect(stepTimeoutMs('route.inbound')).toBe(60_000);
    expect(stepTimeoutMs('compose.tenant')).toBe(150_000);
    expect(stepTimeoutMs('something.new')).toBe(120_000);
  });
});

describe('RoutingLlm failover', () => {
  const claude: ModelRef = { provider: 'anthropic', model: 'claude-opus-5-5' };
  const kimi: ModelRef = { provider: 'moonshot', model: 'kimi-k2.6' };
  const routing: LlmRouting = {
    default: kimi,
    steps: {},
    fallback: claude,
    acknowledgeOffshoreProviders: true,
  };
  const req = {
    ctx: { organizationId: 'o', jobId: null, step: 'interpret.slot' },
    system: 's',
    user: 'u',
    schema: { parse: (v: unknown) => v },
    effort: 'low',
  } as unknown as Parameters<LlmClient['structured']>[0];

  function fakes(behaviour: Record<string, () => unknown>) {
    const calls: string[] = [];
    const factory = (ref: ModelRef): LlmClient => ({
      structured: <T>() => {
        calls.push(ref.provider);
        return Promise.resolve().then(() => behaviour[ref.provider]?.() as T);
      },
      toolTurn: () => Promise.reject(new Error('unused')),
    });
    return { calls, factory };
  }
  const db = null as unknown as DbOrTx;

  beforeEach(() => {
    resetBreakers();
  });

  it('serves from the fallback when the primary times out', async () => {
    const f = fakes({
      moonshot: () => {
        throw new OpenAI.APIConnectionTimeoutError();
      },
      anthropic: () => 'from claude',
    });
    const llm = new RoutingLlm(db, routing, null, f.factory);
    await expect(llm.structured(req)).resolves.toBe('from claude');
    expect(f.calls).toEqual(['moonshot', 'anthropic']);
  });

  it('skips a provider whose breaker is open instead of waiting on it again', async () => {
    const f = fakes({
      moonshot: () => {
        throw new OpenAI.InternalServerError(503, undefined, 'down', new Headers());
      },
      anthropic: () => 'ok',
    });
    const llm = new RoutingLlm(db, routing, null, f.factory);
    for (let i = 0; i < 4; i++) await llm.structured(req);
    // 3 failures open the breaker; the 4th request goes straight to Claude.
    expect(f.calls).toEqual([
      'moonshot',
      'anthropic',
      'moonshot',
      'anthropic',
      'moonshot',
      'anthropic',
      'anthropic',
    ]);
  });

  it('does not fail over on a refusal, and never with a fixed --model override', async () => {
    const refusing = fakes({
      moonshot: () => {
        throw new LlmRefusalError('policy');
      },
      anthropic: () => 'ok',
    });
    await expect(
      new RoutingLlm(db, routing, null, refusing.factory).structured(req),
    ).rejects.toBeInstanceOf(LlmRefusalError);
    expect(refusing.calls).toEqual(['moonshot']);

    const down = fakes({
      moonshot: () => {
        throw new OpenAI.APIConnectionTimeoutError();
      },
      anthropic: () => 'ok',
    });
    await expect(
      new RoutingLlm(db, routing, kimi, down.factory).structured(req),
    ).rejects.toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect(down.calls).toEqual(['moonshot']);
  });
});
