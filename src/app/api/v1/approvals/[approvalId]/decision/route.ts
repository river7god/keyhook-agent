import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordApprovalDecision } from '@/agent/pm-actions';
import { getDb } from '@/db/client';
import { propertyManagers } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { resolveDevOrganization } from '@/domain/organizations';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  /** Until auth exists, the PM picks who they are; must be an active PM of the organization. */
  propertyManagerId: z.uuid(),
  note: z.string().trim().max(500).nullable(),
});

/** A PM approves or rejects pending spend. Approval releases it via the approval-level tool. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const approvalId = z.uuid().parse((await params).approvalId);
    const input = body.parse(await request.json());
    const db = getDb();
    const org = await resolveDevOrganization(db);
    const [pm] = await db
      .select({ email: propertyManagers.email })
      .from(propertyManagers)
      .where(
        and(
          eq(propertyManagers.organizationId, org.id),
          eq(propertyManagers.id, input.propertyManagerId),
          eq(propertyManagers.active, true),
        ),
      );
    if (!pm) throw new DomainError('VALIDATION', 'Unknown property manager');

    const result = await recordApprovalDecision(db, {
      organizationId: org.id,
      approvalId,
      decision: input.decision,
      decidedBy: pm.email,
      note: input.note,
      now: new Date(),
    });
    await inngest.send(
      jobAdvanceRequested.create({ organizationId: org.id, jobId: result.jobId, messageId: null }),
    );
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
