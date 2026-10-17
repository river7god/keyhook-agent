import { z } from 'zod';
import { handBackJob } from '@/agent/pm-actions';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { tradeEnum, urgencyEnum } from '@/db/schema';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  note: z.string().trim().max(500).nullable(),
  urgency: z.enum(urgencyEnum.enumValues).nullable(),
  trade: z.enum(tradeEnum.enumValues).nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireApiUser();
    const jobId = z.uuid().parse((await params).jobId);
    const input = body.parse(await request.json());
    const result = await withOrg(getDb(), user.organizationId, (tx) =>
      handBackJob(tx, {
        organizationId: user.organizationId,
        jobId,
        propertyManagerId: user.propertyManagerId,
        ...input,
        now: new Date(),
      }),
    );
    await inngest.send(
      jobAdvanceRequested.create({ organizationId: user.organizationId, jobId, messageId: null }),
    );
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
