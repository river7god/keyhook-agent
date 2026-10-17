import { z } from 'zod';
import { cancelJob } from '@/agent/pm-actions';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({ reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireApiUser();
    const jobId = z.uuid().parse((await params).jobId);
    const input = body.parse(await request.json());
    const result = await withOrg(getDb(), user.organizationId, (tx) =>
      cancelJob(tx, {
        organizationId: user.organizationId,
        jobId,
        propertyManagerId: user.propertyManagerId,
        reason: input.reason,
      }),
    );
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
