import { z } from 'zod';
import { recordApprovalDecision } from '@/agent/pm-actions';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { deliverQueuedForCase } from '@/domain/messages';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).nullable(),
});

/** The signed-in PM approves or rejects pending spend; approval releases it via approve_spend. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const user = await requireApiUser();
    const approvalId = z.uuid().parse((await params).approvalId);
    const input = body.parse(await request.json());
    const result = await withOrg(getDb(), user.organizationId, (tx) =>
      recordApprovalDecision(tx, {
        organizationId: user.organizationId,
        approvalId,
        decision: input.decision,
        decidedBy: user.email,
        note: input.note,
        now: new Date(),
      }),
    );
    if (result.jobId) {
      await inngest.send(
        jobAdvanceRequested.create({
          organizationId: user.organizationId,
          jobId: result.jobId,
          messageId: null,
        }),
      );
    }
    if (result.arrearsCaseId) {
      const caseId = result.arrearsCaseId;
      await withOrg(getDb(), user.organizationId, (tx) =>
        deliverQueuedForCase(tx, user.organizationId, caseId),
      );
    }
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
