import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLog, llmCalls, messages } from '@/db/schema';

/**
 * Model usage for one organization over a window, from llm_calls and audit_log: the numbers the
 * usage page shows and the Ops analyst reasons over. Aggregates only — no message content,
 * except the short repeated replies used to propose new layer-1 rules.
 */
export interface StepUsage {
  /** Step group: first segment of llm_calls.step ("compose", "interpret", …). */
  group: string;
  model: string;
  calls: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  /** Uncached input tokens (cache reads are counted separately, as both providers report it). */
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsdMicros: number;
  unpricedCalls: number;
}

export interface UsageReport {
  since: Date;
  until: Date;
  days: number;
  steps: StepUsage[];
  totals: {
    calls: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costUsdMicros: number;
    unpricedCalls: number;
    jobs: number;
  };
  /** Layer-1 rule decisions vs model calls for the same questions (slot choice, confirmation). */
  rules: { ruleDecisions: number; modelCallsSameSteps: number };
  /** Short tenant replies seen more than once, most frequent first. */
  repeatedShortReplies: { text: string; count: number }[];
}

const SHORT_REPLY_MAX = 30;

export async function usageReport(
  db: DbOrTx,
  organizationId: string,
  until: Date,
  days = 30,
): Promise<UsageReport> {
  const since = new Date(until.getTime() - days * 86_400_000);
  const inWindow = and(eq(llmCalls.organizationId, organizationId), gte(llmCalls.createdAt, since));
  const group = sql<string>`split_part(${llmCalls.step}, '.', 1)`;
  const model = sql<string>`coalesce(${llmCalls.servedModel}, ${llmCalls.requestedModel})`;

  const [steps, [jobCount], [ruleRow], [modelRow], replies] = await Promise.all([
    db
      .select({
        group,
        model,
        calls: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${llmCalls.error} is not null)::int`,
        p50Ms: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${llmCalls.latencyMs}), 0)::int`,
        p95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${llmCalls.latencyMs}), 0)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)::int`,
        cachedTokens: sql<number>`coalesce(sum(${llmCalls.cacheReadInputTokens}), 0)::int`,
        costUsdMicros: sql<number>`coalesce(sum(${llmCalls.costUsdMicros}), 0)::int`,
        unpricedCalls: sql<number>`count(*) filter (where ${llmCalls.costUsdMicros} is null and ${llmCalls.error} is null)::int`,
      })
      .from(llmCalls)
      .where(inWindow)
      .groupBy(group, model)
      .orderBy(sql`count(*) desc`),
    db
      .select({ n: sql<number>`count(distinct ${llmCalls.jobId})::int` })
      .from(llmCalls)
      .where(inWindow),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          eq(auditLog.action, 'intent.rule'),
          gte(auditLog.createdAt, since),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(llmCalls)
      .where(and(inWindow, inArray(llmCalls.step, ['interpret.slot', 'interpret.confirmation']))),
    db
      .select({
        text: sql<string>`lower(trim(${messages.body}))`,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.direction, 'inbound'),
          eq(messages.senderType, 'tenant'),
          gte(messages.createdAt, since),
          sql`length(trim(${messages.body})) <= ${SHORT_REPLY_MAX}`,
        ),
      )
      .groupBy(sql`lower(trim(${messages.body}))`)
      .having(sql`count(*) > 1`)
      .orderBy(sql`count(*) desc`)
      .limit(20),
  ]);

  const totals = steps.reduce(
    (t, s) => ({
      calls: t.calls + s.calls,
      errors: t.errors + s.errors,
      inputTokens: t.inputTokens + s.inputTokens,
      outputTokens: t.outputTokens + s.outputTokens,
      cachedTokens: t.cachedTokens + s.cachedTokens,
      costUsdMicros: t.costUsdMicros + s.costUsdMicros,
      unpricedCalls: t.unpricedCalls + s.unpricedCalls,
      jobs: t.jobs,
    }),
    {
      calls: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsdMicros: 0,
      unpricedCalls: 0,
      jobs: jobCount?.n ?? 0,
    },
  );
  return {
    since,
    until,
    days,
    steps,
    totals,
    rules: { ruleDecisions: ruleRow?.n ?? 0, modelCallsSameSteps: modelRow?.n ?? 0 },
    repeatedShortReplies: replies,
  };
}

/** Share of all input tokens served from the prompt cache (0–1). */
export function cacheShare(u: { inputTokens: number; cachedTokens: number }): number {
  const all = u.inputTokens + u.cachedTokens;
  return all > 0 ? u.cachedTokens / all : 0;
}
