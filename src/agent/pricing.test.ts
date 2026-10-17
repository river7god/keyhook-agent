import { describe, expect, it } from 'vitest';
import { costUsdMicros } from './pricing';

describe('costUsdMicros', () => {
  it('prices Opus 5.5 tokens in micro-dollars', () => {
    // 1,000 input × $4/MTok = $0.004 = 4,000 µ$; 500 output × $20/MTok = 10,000 µ$
    expect(
      costUsdMicros('claude-opus-5-5', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 10_000,
        cacheCreationInputTokens: 0,
      }),
    ).toBe(4_000 + 10_000 + 2_000);
  });

  it('returns null for unknown models instead of guessing', () => {
    expect(
      costUsdMicros('some-future-model', {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
    ).toBeNull();
  });
});

describe('isPermanentProviderError', () => {
  it('treats auth, bad request, missing model and exhausted balance as permanent', async () => {
    const { isPermanentProviderError } = await import('./llm');
    expect(isPermanentProviderError(401, 'invalid x-api-key')).toBe(true);
    expect(isPermanentProviderError(404, 'model not found')).toBe(true);
    expect(isPermanentProviderError(400, 'Your credit balance is too low')).toBe(true);
    expect(isPermanentProviderError(429, 'account is suspended due to insufficient balance')).toBe(
      true,
    );
  });

  it('keeps rate limits, overload and server errors retryable', async () => {
    const { isPermanentProviderError } = await import('./llm');
    expect(isPermanentProviderError(429, 'Rate limit reached for requests')).toBe(false);
    expect(isPermanentProviderError(529, 'Overloaded')).toBe(false);
    expect(isPermanentProviderError(500, 'Internal error')).toBe(false);
    expect(isPermanentProviderError(undefined, 'connection reset')).toBe(false);
  });
});
