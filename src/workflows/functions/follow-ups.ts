import { cron } from 'inngest';
import { handleFollowUp } from '@/agent/handlers/follow-up';
import { ClaudeLlm } from '@/agent/llm';
import { getDb } from '@/db/client';
import { listDueFollowUps } from '@/domain/follow-ups';
import { inngest } from '../client';
import { perJobConcurrency } from '../concurrency';
import { followUpDue } from '../events';

/**
 * Sweeper: every 5 minutes, emit an event per due follow-up. The database is the source of truth
 * (nothing is lost if an event is), and the event id makes repeats within Inngest's dedupe window
 * no-ops; handleFollowUp's claim makes any remaining duplicate harmless.
 */
export const followUpSweeper = inngest.createFunction(
  { id: 'follow-up-sweeper', triggers: [cron('*/5 * * * *')] },
  async ({ step }) => {
    const due = await step.run('list-due', async () =>
      (await listDueFollowUps(getDb(), new Date(), 200)).map((f) => ({
        id: f.id,
        organizationId: f.organizationId,
        jobId: f.jobId,
        attempt: f.attempt,
      })),
    );
    if (due.length) {
      await step.sendEvent(
        'emit-due',
        due.map((f) => ({
          ...followUpDue.create({
            organizationId: f.organizationId,
            jobId: f.jobId,
            followUpId: f.id,
          }),
          id: `followup-${f.id}-${f.attempt}`,
        })),
      );
    }
    return { emitted: due.length };
  },
);

export const followUpHandler = inngest.createFunction(
  { id: 'follow-up-handle', triggers: [followUpDue], concurrency: perJobConcurrency, retries: 3 },
  async ({ event, step }) =>
    step.run('handle', () => {
      const db = getDb();
      return handleFollowUp(
        { db, llm: new ClaudeLlm(db), now: () => new Date() },
        event.data.followUpId,
      );
    }),
);
