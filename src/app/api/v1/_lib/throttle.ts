import { DomainError } from '@/domain/errors';

/**
 * Per-process failed-login throttle (10 failures per key per 15 minutes). On serverless this is
 * per instance — a speed bump against guessing, not a guarantee; move to a shared store if
 * login is ever exposed to real users.
 */
class FailureThrottle {
  private failures = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): void {
    const recent = this.recent(key);
    if (recent.length >= this.max) {
      throw new DomainError('RATE_LIMITED', 'Too many failed sign-in attempts; try again later');
    }
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), Date.now()]);
  }

  private recent(key: string): number[] {
    const cutoff = Date.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((t) => t > cutoff);
  }
}

export const loginThrottle = new FailureThrottle(10, 15 * 60_000);
