import { advanceJob } from '@/agent/advance';
import { ClaudeLlm } from '@/agent/llm';
import { getDb } from '@/db/client';
import { inngest } from '../client';
import { jobAdvanceRequested } from '../events';

/**
 * Orchestrator: one run per job event, serialised per job so two messages for the same job never
 * advance it concurrently. Side effects inside advanceJob are idempotent and inbound messages are
 * processed at most once, so Inngest retries are safe.
 */
export const jobAdvance = inngest.createFunction(
  {
    id: 'job-advance',
    triggers: [jobAdvanceRequested],
    concurrency: { key: 'event.data.jobId', limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    return step.run('advance', () => {
      const db = getDb();
      return advanceJob(
        { db, llm: new ClaudeLlm(db), now: () => new Date() },
        {
          organizationId: event.data.organizationId,
          jobId: event.data.jobId,
          messageId: event.data.messageId,
        },
      );
    });
  },
);
