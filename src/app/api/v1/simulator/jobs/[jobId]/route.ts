import { and, desc, eq, sum } from 'drizzle-orm';
import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { auditLog, llmCalls } from '@/db/schema';
import { getAgentActivity } from '@/domain/agent-activity';
import { listJobMedia } from '@/domain/media-store';
import { getJob } from '@/domain/jobs';
import { listJobMessages } from '@/domain/messages';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

/** Job snapshot for the simulator: state, conversation, recent audit trail, LLM spend. */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireApiUser();
    const jobId = z.uuid().parse((await params).jobId);
    const org = user.organizationId;
    const snapshot = await withOrg(getDb(), org, async (tx) => {
      const [job, messages, audit, [spend]] = await Promise.all([
        getJob(tx, org, jobId),
        listJobMessages(tx, org, jobId),
        tx
          .select({
            id: auditLog.id,
            action: auditLog.action,
            actorType: auditLog.actorType,
            reason: auditLog.reason,
            outcome: auditLog.outcome,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(and(eq(auditLog.organizationId, org), eq(auditLog.jobId, jobId)))
          .orderBy(desc(auditLog.id))
          .limit(40),
        tx
          .select({ costUsdMicros: sum(llmCalls.costUsdMicros).mapWith(Number) })
          .from(llmCalls)
          .where(and(eq(llmCalls.organizationId, org), eq(llmCalls.jobId, jobId))),
      ]);
      const activity = await getAgentActivity(tx, job, new Date());
      const media = await listJobMedia(tx, org, jobId);
      return { job, messages, audit, activity, media, llmCostUsdMicros: spend?.costUsdMicros ?? 0 };
    });
    return ok(snapshot);
  } catch (err) {
    return toErrorResponse(err);
  }
}
