import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLog, llmCalls } from '@/db/schema';

/**
 * What the agent did on one job, in order: every model call (step, model, tokens, cache, latency,
 * cost, outcome) and every tool call, plus rule-based decisions that skipped a model call.
 * Built from llm_calls and audit_log, which record everything already.
 */
export type TraceRow =
  | {
      kind: 'model';
      at: Date;
      step: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      latencyMs: number;
      costUsdMicros: number | null;
      outcome: 'ok' | 'error';
      note: string | null;
    }
  | { kind: 'tool' | 'rule'; at: Date; name: string; outcome: string; reason: string | null };

export interface TraceTotals {
  modelCalls: number;
  failedModelCalls: number;
  toolCalls: number;
  ruleDecisions: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsdMicros: number;
  unpricedCalls: number;
  modelLatencyMs: number;
}

export interface StepSummary {
  step: string;
  calls: number;
  latencyMs: number;
  tokens: number;
  costUsdMicros: number;
}

export async function getJobTrace(
  db: DbOrTx,
  organizationId: string,
  jobId: string,
  toolNames: ReadonlySet<string>,
): Promise<{ rows: TraceRow[]; totals: TraceTotals; bySteps: StepSummary[] }> {
  const [calls, audits] = await Promise.all([
    db
      .select()
      .from(llmCalls)
      .where(and(eq(llmCalls.organizationId, organizationId), eq(llmCalls.jobId, jobId)))
      .orderBy(asc(llmCalls.createdAt)),
    db
      .select({
        action: auditLog.action,
        outcome: auditLog.outcome,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.jobId, jobId)))
      .orderBy(asc(auditLog.id)),
  ]);

  const rows: TraceRow[] = [
    ...calls.map((c): TraceRow => ({
      kind: 'model',
      at: c.createdAt,
      step: c.step,
      model: c.servedModel ?? c.requestedModel,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cachedTokens: c.cacheReadInputTokens,
      latencyMs: c.latencyMs,
      costUsdMicros: c.costUsdMicros,
      outcome: c.error ? 'error' : 'ok',
      note: c.error ? errorText(c.error) : c.stopReason,
    })),
    ...audits
      .filter((a) => toolNames.has(a.action) || a.action === 'intent.rule')
      .map((a): TraceRow => ({
        kind: a.action === 'intent.rule' ? 'rule' : 'tool',
        at: a.createdAt,
        name: a.action,
        outcome: a.outcome,
        reason: a.reason,
      })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());

  const totals: TraceTotals = {
    modelCalls: 0,
    failedModelCalls: 0,
    toolCalls: 0,
    ruleDecisions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsdMicros: 0,
    unpricedCalls: 0,
    modelLatencyMs: 0,
  };
  const steps = new Map<string, StepSummary>();
  for (const r of rows) {
    if (r.kind !== 'model') {
      if (r.kind === 'tool') totals.toolCalls++;
      else totals.ruleDecisions++;
    } else {
      totals.modelCalls++;
      if (r.outcome === 'error') totals.failedModelCalls++;
      totals.inputTokens += r.inputTokens;
      totals.outputTokens += r.outputTokens;
      totals.cachedTokens += r.cachedTokens;
      totals.modelLatencyMs += r.latencyMs;
      if (r.costUsdMicros === null) totals.unpricedCalls++;
      else totals.costUsdMicros += r.costUsdMicros;
      const s = steps.get(r.step) ?? {
        step: r.step,
        calls: 0,
        latencyMs: 0,
        tokens: 0,
        costUsdMicros: 0,
      };
      s.calls++;
      s.latencyMs += r.latencyMs;
      s.tokens += r.inputTokens + r.outputTokens;
      s.costUsdMicros += r.costUsdMicros ?? 0;
      steps.set(r.step, s);
    }
  }
  return { rows, totals, bySteps: [...steps.values()].sort((a, b) => b.latencyMs - a.latencyMs) };
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message).slice(0, 120);
  }
  return 'error';
}
