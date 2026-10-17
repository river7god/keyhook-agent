import { z } from 'zod';
import { pmSendMessage } from '@/agent/pm-actions';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { deliverQueued } from '@/domain/messages';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  recipient: z.enum(['tenant', 'tradie']),
  body: z.string().trim().min(1).max(2000),
  /** Client-generated id so a double-submit sends once. */
  clientRequestId: z.uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireApiUser();
    const jobId = z.uuid().parse((await params).jobId);
    const input = body.parse(await request.json());
    const result = await withOrg(getDb(), user.organizationId, (tx) =>
      pmSendMessage(tx, {
        organizationId: user.organizationId,
        jobId,
        propertyManagerId: user.propertyManagerId,
        ...input,
      }),
    );
    // After commit: hand the queued message to the messaging adapter.
    await withOrg(getDb(), user.organizationId, (tx) =>
      deliverQueued(tx, user.organizationId, jobId),
    );
    return ok(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
