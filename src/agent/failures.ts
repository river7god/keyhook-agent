import type { Db } from '@/db/client';
import { getJob } from '@/domain/jobs';
import { escalateTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { toolCtx } from './handlers/shared';

/**
 * When the agent cannot do its job (model refusal, unusable output, retries exhausted), hand the
 * job to a PM instead of leaving it silently stuck. No-op for jobs a PM already owns or that ended.
 */
export async function escalateOnAgentFailure(
  db: Db,
  args: { organizationId: string; jobId: string; reason: string; now: Date },
): Promise<boolean> {
  const job = await getJob(db, args.organizationId, args.jobId);
  if (job.state === 'ESCALATED' || job.state === 'CLOSED' || job.state === 'CANCELLED')
    return false;
  const result = await db.transaction((tx) =>
    executeTool(escalateTool, toolCtx(tx, job, 'Agent failure', args.now, ':failure'), {
      reason: `agent could not continue: ${args.reason}`.slice(0, 300),
      summary: `${job.title} (${job.state}). The agent stopped because of an internal problem, not a business rule.`,
      whatHasBeenDone: `Job reached ${job.state} automatically.`,
      recommendation: 'Review the timeline and continue manually, or hand back to retry.',
    }),
  );
  return result.ok;
}
