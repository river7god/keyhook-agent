import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { latestAuditOutput, writeAudit } from '@/domain/audit';
import { usageReport, type UsageReport } from '@/domain/usage';
import type { AgentDeps } from '../handlers/shared';
import { detectInsights, type Insight } from './insights';
import { OPS_ANALYST_SYSTEM } from './prompts';

/**
 * Ops analyst: a scheduled agent that reads the organization's model usage and writes a ranked
 * weekly brief. Code computes the numbers and detects the findings (insights.ts); the model only
 * ranks and explains them, and anything it names that code did not detect is dropped. It
 * recommends; a person changes routing or rules after an eval. The brief is stored as an
 * `ops.analysis` audit row.
 */
export const opsBriefOutput = z.object({
  headline: z.string().describe('One sentence: the most important thing this week'),
  priorities: z.array(
    z.object({
      insightId: z.string().describe('The id of one of the given findings'),
      why: z.string().describe('Why it matters now, using the given numbers'),
      nextStep: z.string().describe('The concrete next step for the engineer'),
    }),
  ),
});
export type OpsBrief = z.infer<typeof opsBriefOutput>;

export interface OpsAnalysis {
  period: { since: string; until: string; days: number };
  totals: UsageReport['totals'];
  rules: UsageReport['rules'];
  insights: Insight[];
  brief: OpsBrief | null;
}

export async function runOpsAnalysis(
  deps: AgentDeps,
  organizationId: string,
): Promise<OpsAnalysis> {
  const now = deps.now();
  const report = await usageReport(deps.db, organizationId, now);
  const insights = detectInsights(report);
  let brief: OpsBrief | null = null;
  if (insights.length) {
    // Aggregates only: the repeated short replies stay out of the prompt (they are tenant text).
    const out = await deps.llm.structured({
      ctx: { organizationId, jobId: null, step: 'ops.analysis' },
      system: OPS_ANALYST_SYSTEM,
      user: JSON.stringify(
        {
          periodDays: report.days,
          totals: report.totals,
          layer1Rules: report.rules,
          steps: report.steps,
          findings: insights.map((i) => ({
            ...i,
            evidence:
              i.id === 'rule-candidates' ? 'repeated short replies (text withheld)' : i.evidence,
          })),
        },
        null,
        2,
      ),
      schema: opsBriefOutput,
      effort: 'low',
    });
    const known = new Set(insights.map((i) => i.id));
    brief = { ...out, priorities: out.priorities.filter((p) => known.has(p.insightId)) };
  }
  const analysis: OpsAnalysis = {
    period: { since: report.since.toISOString(), until: now.toISOString(), days: report.days },
    totals: report.totals,
    rules: report.rules,
    insights,
    brief,
  };
  await writeAudit(deps.db, {
    organizationId,
    actorType: 'agent',
    action: 'ops.analysis',
    reason: insights.length
      ? `${String(insights.length)} finding(s) from ${String(report.totals.calls)} model calls`
      : 'No findings',
    output: analysis,
    outcome: 'ok',
  });
  return analysis;
}

export async function latestOpsAnalysis(
  db: DbOrTx,
  organizationId: string,
): Promise<{ at: Date; analysis: OpsAnalysis } | null> {
  const row = await latestAuditOutput(db, organizationId, 'ops.analysis');
  // Written only by runOpsAnalysis above, so the stored shape is OpsAnalysis.
  return row ? { at: row.at, analysis: row.output as OpsAnalysis } : null;
}
