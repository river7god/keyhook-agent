import { escalateOnAgentFailure } from '@/agent/failures';
import { getDb } from '@/db/client';

/**
 * Shared onFailure handler: after Inngest exhausts retries, escalate the job so a PM sees it.
 * The failure payload wraps the original event, whose data always carries organizationId + jobId.
 */
export async function escalateAfterRetries({
  event,
  error,
}: {
  event: { data: { event: { data: unknown } } };
  error: Error;
}): Promise<{ escalated: boolean }> {
  const data = event.data.event.data as { organizationId?: string; jobId?: string };
  if (!data.organizationId || !data.jobId) return { escalated: false };
  const escalated = await escalateOnAgentFailure(getDb(), {
    organizationId: data.organizationId,
    jobId: data.jobId,
    reason: `retries exhausted (${error.message})`,
    now: new Date(),
  });
  return { escalated };
}
