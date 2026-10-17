import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { ingestMessage } from '@/domain/inbound';
import { assertSimulatorAllowance } from '@/domain/usage-limits';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  senderType: z.enum(['tenant', 'tradie']),
  senderId: z.uuid(),
  jobId: z.uuid().nullable(),
  body: z.string().trim().min(1).max(2000),
});

/**
 * Simulated inbound SMS/email from a tenant or tradie of the signed-in PM's organization.
 * Rate- and budget-limited: each message triggers model calls.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = body.parse(await request.json());
    const org = user.organizationId;
    const result = await withOrg(getDb(), org, async (tx) => {
      await assertSimulatorAllowance(tx, org, new Date());
      return ingestMessage(tx, { organizationId: org, ...input });
    });
    await inngest.send(
      jobAdvanceRequested.create({
        organizationId: org,
        jobId: result.jobId,
        messageId: result.messageId,
      }),
    );
    return ok(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
