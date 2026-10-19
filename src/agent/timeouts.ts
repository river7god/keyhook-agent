/** Per-request limits shared by every provider client. */

/**
 * Per-request time limit by step group, so a hung provider fails over (or Inngest retries)
 * instead of holding the run for the SDK default of 10 minutes. Set from measured latency:
 * Kimi K2.6 locally — compose p95 100 s (max 186 s), triage p95 39 s, interpret p95 20 s,
 * act p95 14 s. Limits sit above those tails; Claude is well inside all of them.
 */
const STEP_TIMEOUT_MS: Record<string, number> = {
  route: 60_000,
  interpret: 90_000,
  act: 90_000,
  triage: 120_000,
  retriage: 120_000,
  vision: 120_000,
  compose: 150_000,
  redteam: 300_000,
};
const DEFAULT_TIMEOUT_MS = 120_000;

export function stepTimeoutMs(step: string): number {
  return STEP_TIMEOUT_MS[step.split('.')[0] ?? ''] ?? DEFAULT_TIMEOUT_MS;
}

/**
 * SDK request options for a step. One SDK retry covers a dropped connection; durable retries
 * belong to Inngest and provider failover to RoutingLlm, so retries don't multiply the wait.
 */
export function requestOptions(step: string): { timeout: number; maxRetries: number } {
  return { timeout: stepTimeoutMs(step), maxRetries: 1 };
}
