import { cron } from 'inngest';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { organizations } from '@/db/schema';
import { scanRepeatedFaults } from '@/domain/portfolio-monitor';
import { inngest } from '../client';

/** Daily Portfolio Monitor scan, one step per organization (spec §12 R7). */
export const portfolioMonitor = inngest.createFunction(
  { id: 'portfolio-monitor', triggers: [cron('TZ=Pacific/Auckland 0 6 * * *')] },
  async ({ step }) => {
    const orgIds = await step.run('list-organizations', async () =>
      (await getDb().select({ id: organizations.id }).from(organizations)).map((o) => o.id),
    );
    const results: Record<string, { created: number; updated: number }> = {};
    for (const id of orgIds) {
      results[id] = await step.run(`scan-${id}`, () =>
        withOrg(getDb(), id, (tx) => scanRepeatedFaults(tx, id, new Date())),
      );
    }
    return results;
  },
);
