import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { feedbackInputSchema, recordFeedback } from '@/domain/feedback';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

/** The signed-in PM flags something the agent got wrong on this job. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireApiUser();
    const jobId = z.uuid().parse((await params).jobId);
    const input = feedbackInputSchema.parse(await request.json());
    const row = await withOrg(getDb(), user.organizationId, (tx) =>
      recordFeedback(tx, {
        organizationId: user.organizationId,
        jobId,
        propertyManagerId: user.propertyManagerId,
        input,
      }),
    );
    return ok({ id: row.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
