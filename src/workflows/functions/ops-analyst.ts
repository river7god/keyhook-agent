import { cron } from 'inngest';
import { llmForOrganization } from '@/agent/providers';
import { runOpsAnalysis } from '@/agent/ops/analyst';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { organizations } from '@/db/schema';
import { inngest } from '../client';
import { opsAnalysisRequested } from '../events';

async function analyse(organizationId: string) {
  const db = getDb();
  const llm = await llmForOrganization(db, organizationId);
  const a = await withOrg(db, organizationId, (tx) =>
    runOpsAnalysis({ db: tx, llm, now: () => new Date() }, organizationId),
  );
  return { findings: a.insights.length, calls: a.totals.calls };
}

/** Weekly Ops analyst brief, Monday 07:00 NZ, one step per organization. */
export const opsAnalystWeekly = inngest.createFunction(
  { id: 'ops-analyst-weekly', triggers: [cron('TZ=Pacific/Auckland 0 7 * * 1')] },
  async ({ step }) => {
    const orgIds = await step.run('list-organizations', async () =>
      (await getDb().select({ id: organizations.id }).from(organizations)).map((o) => o.id),
    );
    const results: Record<string, { findings: number; calls: number }> = {};
    for (const id of orgIds) results[id] = await step.run(`analyse-${id}`, () => analyse(id));
    return results;
  },
);

/** On demand for one organization. */
export const opsAnalysisNow = inngest.createFunction(
  {
    id: 'ops-analysis-now',
    triggers: [opsAnalysisRequested],
    concurrency: { key: 'event.data.organizationId', limit: 1 },
  },
  async ({ event, step }) => step.run('analyse', () => analyse(event.data.organizationId)),
);
