import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LlmConfigError } from '../llm';

/**
 * Worth trying another provider: timeouts, connection errors, 408/409/429/5xx, and config errors
 * (missing key, auth, exhausted balance). Not worth it: a refusal or an unusable answer — the
 * request reached a healthy model, and another model is not a fix for the content.
 */
export function shouldFailOver(err: unknown): boolean {
  if (err instanceof LlmConfigError) return true;
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError)
    return true;
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined;
    return (
      status === undefined || status === 408 || status === 409 || status === 429 || status >= 500
    );
  }
  return false;
}

/**
 * Classic three-state breaker. Closed: calls go through; `threshold` failures inside `windowMs`
 * open it. Open: the provider is skipped for `openMs`. Then half-open: one trial call; success
 * closes it, failure opens it again.
 *
 * State is per process. On serverless every instance learns on its own, which is still useful
 * (a hot instance stops paying 60 s timeouts) but not shared; the production version keeps the
 * counters in Redis/Postgres so one instance's discovery protects all of them.
 */
export class CircuitBreaker {
  private failures: number[] = [];
  private openUntil = 0;
  private trialInFlight = false;

  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 60_000,
    private readonly openMs = 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openUntil === 0) return 'closed';
    return this.clock() < this.openUntil ? 'open' : 'half-open';
  }

  /** May a call go to this provider now? Half-open lets exactly one trial through. */
  allow(): boolean {
    const s = this.state;
    if (s === 'closed') return true;
    if (s === 'open' || this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  success(): void {
    this.failures = [];
    this.openUntil = 0;
    this.trialInFlight = false;
  }

  failure(): void {
    const now = this.clock();
    if (this.state === 'half-open') {
      this.trialInFlight = false;
      this.openUntil = now + this.openMs;
      return;
    }
    this.failures = [...this.failures.filter((t) => now - t < this.windowMs), now];
    if (this.failures.length >= this.threshold) {
      this.openUntil = now + this.openMs;
      this.failures = [];
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

/** One breaker per provider:model, shared by every RoutingLlm in this process. */
export function breakerFor(key: string): CircuitBreaker {
  let b = breakers.get(key);
  if (!b) {
    b = new CircuitBreaker();
    breakers.set(key, b);
  }
  return b;
}

export function resetBreakers(): void {
  breakers.clear();
}
