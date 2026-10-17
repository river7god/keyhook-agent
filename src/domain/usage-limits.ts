import { and, count, eq, gt, isNull, sum } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { llmCalls, messages } from '@/db/schema';
import { DomainError } from './errors';

/**
 * Guards on the simulator — the only way an outside user can trigger model calls — so a public
 * demo cannot run up an API bill. Limits are per organization and come from env:
 *   SIMULATOR_MAX_MESSAGES_PER_HOUR (default 60), DAILY_LLM_BUDGET_USD (default 5).
 * Calls whose cost is unknown (model without a configured price) count as
 * UNKNOWN_LLM_CALL_COST_USD each (default 0.05), so the budget still binds.
 * Jobs already in flight keep running; only new inbound simulator messages are refused.
 */
export async function assertSimulatorAllowance(
  db: DbOrTx,
  organizationId: string,
  now: Date,
): Promise<void> {
  const maxPerHour = Number(process.env.SIMULATOR_MAX_MESSAGES_PER_HOUR ?? 60);
  const dailyBudgetMicros = Number(process.env.DAILY_LLM_BUDGET_USD ?? 5) * 1e6;
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const unknownCallMicros = Number(process.env.UNKNOWN_LLM_CALL_COST_USD ?? 0.05) * 1e6;
  const [[recent], [spend], [unpriced]] = await Promise.all([
    db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.direction, 'inbound'),
          gt(messages.createdAt, hourAgo),
        ),
      ),
    db
      .select({ micros: sum(llmCalls.costUsdMicros).mapWith(Number) })
      .from(llmCalls)
      .where(and(eq(llmCalls.organizationId, organizationId), gt(llmCalls.createdAt, dayAgo))),
    db
      .select({ n: count() })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.organizationId, organizationId),
          gt(llmCalls.createdAt, dayAgo),
          isNull(llmCalls.costUsdMicros),
        ),
      ),
  ]);
  if ((recent?.n ?? 0) >= maxPerHour) {
    throw new DomainError('RATE_LIMITED', `Simulator limit reached (${maxPerHour} messages/hour)`);
  }
  const spent = (spend?.micros ?? 0) + (unpriced?.n ?? 0) * unknownCallMicros;
  if (spent >= dailyBudgetMicros) {
    throw new DomainError('RATE_LIMITED', 'Daily AI budget for this organization is used up');
  }
}
