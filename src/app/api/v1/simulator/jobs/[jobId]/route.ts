import { and, desc, eq, sum } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { auditLog, llmCalls } from '@/db/schema';
import { getJob } from '@/domain/jobs';
import { listJobMessages } from '@/domain/messages';
import { resolveDevOrganization } from '@/domain/organizations';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

/** Job snapshot for the simulator: state, conversation, recent audit trail, LLM spend. */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = z.uuid().parse((await params).jobId);
    const db = getDb();
    const org = await resolveDevOrganization(db);
    const [job, messages, audit, [spend]] = await Promise.all([
      getJob(db, org.id, jobId),
      listJobMessages(db, org.id, jobId),
      db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          actorType: auditLog.actorType,
          reason: auditLog.reason,
          outcome: auditLog.outcome,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, org.id), eq(auditLog.jobId, jobId)))
        .orderBy(desc(auditLog.id))
        .limit(40),
      db
        .select({ costUsdMicros: sum(llmCalls.costUsdMicros).mapWith(Number) })
        .from(llmCalls)
        .where(and(eq(llmCalls.organizationId, org.id), eq(llmCalls.jobId, jobId))),
    ]);
    return ok({ job, messages, audit, llmCostUsdMicros: spend?.costUsdMicros ?? 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
