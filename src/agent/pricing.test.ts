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
