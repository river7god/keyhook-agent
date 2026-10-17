import { z } from 'zod';
import { getDb } from '@/db/client';
import { ingestMessage } from '@/domain/inbound';
import { resolveDevOrganization } from '@/domain/organizations';
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

/** Simulated inbound SMS/email from a tenant or tradie. */
export async function POST(request: Request) {
  try {
    const input = body.parse(await request.json());
    const db = getDb();
    const org = await resolveDevOrganization(db);
    const result = await ingestMessage(db, { organizationId: org.id, ...input });
    await inngest.send(
      jobAdvanceRequested.create({
        organizationId: org.id,
        jobId: result.jobId,
        messageId: result.messageId,
      }),
    );
    return ok(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
