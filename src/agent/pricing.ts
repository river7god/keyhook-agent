/**
 * USD per million tokens (Anthropic first-party list prices, checked 2026-10-17).
 * Cache writes (5-minute TTL) bill at 1.25× input. Unknown models → cost null, never a guess.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Integer USD micro-dollars: tokens × ($/MTok) works out to micro-dollars directly. */
/**
 * Extra/override prices from env, e.g. for non-Claude providers whose prices change:
 *   LLM_PRICES_JSON={"deepseek:deepseek-chat":{"input":0.3,"output":1.2,"cacheRead":0.03}}
 * Keys are a bare Claude model id or "provider:model".
 */
function envPrices(): Record<string, { input: number; output: number; cacheRead: number }> {
  try {
    return process.env.LLM_PRICES_JSON
      ? (JSON.parse(process.env.LLM_PRICES_JSON) as ReturnType<typeof envPrices>)
      : {};
  } catch {
    return {};
  }
}

export function costUsdMicros(model: string, u: TokenUsage): number | null {
  const p = envPrices()[model] ?? PRICES[model];
  if (!p) return null;
  return Math.round(
    u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadInputTokens * p.cacheRead +
      u.cacheCreationInputTokens * p.input * 1.25,
  );
}
